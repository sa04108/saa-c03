import {
  callAssistant as call,
  listConversations,
  listTurns,
  loadConversation,
  listConversationSelection,
  deleteConversations,
  saveTurn,
} from "@/lib/backend/assistant";
import {
  renderMessages,
  renderSuggestions,
  renderSessions as renderSessionList,
  disposeViews,
} from "./views";
import { createPanelLayout } from "./panel-layout";
import { createPanelNavigation } from "./panel-navigation";
import { contextSourceHref } from "@/lib/study/assistant-context";

export function createAssistantController({ fab, panel, tooltip, account, navigate }) {
  const lifetime = new AbortController();
  let disposed = false;
  const icons = "/assets/assistant-icons.svg";
  const mobile = matchMedia("(max-width:760px)");
  const keyboardSubmit = matchMedia("(hover: hover) and (pointer: fine)");
  const general = {
    id: "general",
    kind: "general",
    title: "SAA-C03 · 자유 질문",
    text: "",
    hasImages: false,
  };
  const generalQuestions = [
    "SAA-C03 공부를 어디서부터 시작하면 좋을까?",
    "헷갈리기 쉬운 AWS 서비스를 비교해 줘.",
    "고가용성과 내결함성은 어떻게 달라?",
    "비용 최적화 문제를 푸는 요령을 알려줘.",
  ];
  const threads = new Map();
  let thread, opener, request, tooltipTarget, historyRequest, historyCursor;
  let historyView = false;
  let historySessions = [];
  let historyEditing = false,
    historyLoading = false,
    historyDeleting = false,
    deleteConfirming = false,
    selectionRequest,
    selectionOwner;
  let availableHistoryIds = new Set(),
    selectedHistoryIds = new Set();
  const selectionTimes = new Map(),
    selectionDays = new Map();
  const inertBefore = new Map();
  let originalOverflow = null;

  const $ = (selector) => panel.querySelector(selector);
  const prompt = $("#saa-ai-prompt");
  const saveError = $("[data-save-error]");
  const layout = createPanelLayout({ panel, mobile });
  const navigation = createPanelNavigation({
    panel,
    mobile,
    show: () => open(null, fab),
    hide: hidePanel,
    visit: navigate,
  });

  function hideTooltip() {
    tooltipTarget?.removeAttribute("aria-describedby");
    tooltipTarget = null;
    tooltip.hidden = true;
  }
  function showTooltip(button) {
    hideTooltip();
    tooltipTarget = button;
    tooltip.textContent = button.getAttribute("aria-label");
    tooltip.hidden = false;
    button.setAttribute("aria-describedby", tooltip.id);
    const rect = button.getBoundingClientRect(),
      bounds = tooltip.getBoundingClientRect();
    const edge = 8,
      gap = 8;
    const left = Math.max(
      edge,
      Math.min(rect.right - bounds.width, innerWidth - bounds.width - edge),
    );
    const above = rect.top - bounds.height - gap;
    const top = Math.max(
      edge,
      Math.min(
        above >= edge ? above : rect.bottom + gap,
        innerHeight - bounds.height - edge,
      ),
    );
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  }
  function makeThread(context, conversationId = crypto.randomUUID()) {
    return {
      context,
      suggestionContext: context,
      conversationId,
      history: [],
      draft: "",
      suggestions: context.kind === "general" ? generalQuestions : null,
      error: "",
      suggestionError: false,
      unsaved: [],
      saved: false,
      saving: false,
      oldestTurn: null,
      hasOlder: false,
    };
  }
  function getThread(context, suggestionContext = context) {
    const key = context.id + "\n" + context.text;
    if (!threads.has(key)) {
      threads.set(key, makeThread(context));
      if (threads.size > 20) threads.delete(threads.keys().next().value);
    }
    const target = threads.get(key);
    target.suggestionContext = suggestionContext;
    return target;
  }
  function modalState() {
    const modal = mobile.matches && !panel.hidden;
    panel.setAttribute("aria-modal", String(modal));
    if (modal) {
      if (originalOverflow === null)
        originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      for (const child of document.body.children) {
        if (
          child === panel ||
          child === fab ||
          /^(SCRIPT|STYLE|LINK)$/.test(child.tagName)
        )
          continue;
        if (!inertBefore.has(child)) inertBefore.set(child, child.inert);
        child.inert = true;
      }
    } else {
      if (originalOverflow !== null)
        document.body.style.overflow = originalOverflow;
      originalOverflow = null;
      for (const [node, inert] of inertBefore) node.inert = inert;
      inertBefore.clear();
    }
    layout.syncViewport();
  }
  function open(context, source, suggestionContext = context) {
    hideTooltip();
    if (context) {
      if (historyDeleting) return;
      exitHistoryEdit();
      if (thread) thread.draft = prompt.value;
      cancelRequest();
      cancelHistory();
      historyView = false;
      thread = getThread(context, suggestionContext);
    } else if (!thread) thread = getThread(general);
    opener = source || document.activeElement;
    panel.hidden = false;
    document.body.classList.add("saa-ai-open");
    fab.setAttribute("aria-expanded", "true");
    fab.setAttribute("aria-label", "AI 어시스턴트 닫기");
    fab.querySelector("use").setAttribute("href", icons + "#close");
    fab.querySelector("span").textContent = "AI 어시스턴트 닫기";
    render();
    modalState();
    layout.showHeader();
    navigation.sync();
    $("#saa-ai-heading").focus({ preventScroll: true });
    if (historyView && !historyDeleting) void loadHistory();
    else if (!thread.suggestions && !thread.history.length && !request)
      void suggestions();
  }
  function locationChanged() {
    hideTooltip();
    modalState();
    navigation.sync();
    if (mobile.matches && !panel.hidden && !panel.contains(document.activeElement)) {
      $("#saa-ai-heading").focus({ preventScroll: true });
    }
  }
  function close() {
    hidePanel();
    navigation.sync();
  }
  function hidePanel() {
    if (panel.hidden) return;
    if (!historyDeleting) exitHistoryEdit();
    cancelHistory();
    thread.draft = prompt.value;
    prompt.blur();
    panel.hidden = true;
    document.body.classList.remove("saa-ai-open");
    fab.setAttribute("aria-expanded", "false");
    fab.setAttribute("aria-label", "AI 어시스턴트 열기");
    fab.querySelector("use").setAttribute("href", icons + "#robot");
    fab.querySelector("span").textContent = "AI 어시스턴트";
    modalState();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    else fab.focus({ preventScroll: true });
  }
  function cancelRequest() {
    if (!request) return;
    clearTimeout(request.timer);
    request.controller.abort();
    if (request.kind === "chat") request.thread.draft = request.question;
    request = null;
  }
  function updateComposer() {
    thread.draft = prompt.value;
    $(".saa-ai-send").disabled =
      !prompt.value.trim() || request?.kind === "chat";
    prompt.readOnly = request?.kind === "chat";
    layout.resizeComposer();
  }
  function localDay(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }
  function render() {
    if (disposed) return;
    const c = thread.context;
    $("[data-history]").hidden = !historyView;
    $("[data-history-toggle]").setAttribute(
      "aria-pressed",
      String(historyView),
    );
    $("[data-scroll]").hidden = historyView;
    $("form").hidden = historyView;
    panel.classList.toggle("saa-ai-history-mode", historyView);
    if (historyView) layout.showHeader();
    $("[data-context-title]").textContent = c.title;
    const sourceLink = $("[data-context-link]");
    const sourceHref = contextSourceHref(c);
    sourceLink.title = c.title;
    if (sourceHref) sourceLink.setAttribute("href", sourceHref);
    else sourceLink.removeAttribute("href");
    const heading =
      c.kind === "concept"
        ? `${c.title.split(" (")[0]},\n어떤 점이 궁금한가요?`
        : c.kind === "question"
          ? "이 문제,\n함께 풀어볼까요?"
          : "AWS 공부,\n무엇이 궁금한가요?";
    $("[data-welcome-title]").replaceChildren(
      ...heading
        .split("\n")
        .flatMap((line, i) =>
          i ? [document.createElement("br"), line] : [line],
        ),
    );
    $("[data-welcome]").hidden =
      !!thread.history.length || request?.kind === "chat";
    renderSuggestions(
      $("[data-suggestions]"),
      thread.suggestions || [],
      (question) => {
        prompt.value = question;
        updateComposer();
        prompt.focus({ preventScroll: true });
      },
    );
    $("[data-suggestion-note]").hidden = !thread.suggestions;
    const history =
      request?.kind === "chat"
        ? [
            ...thread.history,
            {
              role: "user",
              text: request.question,
              createdAt: request.createdAt,
            },
          ]
        : thread.history;
    renderMessages($("[data-messages]"), history);
    const feedback = $("[data-feedback]");
    feedback.textContent = request
      ? request.kind === "suggestions"
        ? "이 항목의 예상 질문을 준비하고 있어요…"
        : "답변을 작성하고 있어요…"
      : thread.error;
    feedback.hidden = !feedback.textContent;
    feedback.dataset.error = String(!request && !!thread.error);
    feedback.classList.toggle("saa-ai-loading", !!request);
    $("[data-retry]").hidden = !!request || !thread.suggestionError;
    $("[data-image-note]").hidden = !c.hasImages;
    $("[data-older]").hidden = !thread.hasOlder;
    saveError.hidden = !thread.unsaved.length;
    if (saveError.hidden && tooltipTarget === saveError) hideTooltip();
    prompt.value = thread.draft;
    updateComposer();
  }

  function historyBusy(busy) {
    historyLoading = busy;
    $("[data-history-list]").setAttribute("aria-busy", String(busy));
    updateHistoryControls();
  }
  function cancelHistory() {
    historyRequest?.abort();
    historyRequest = null;
    historyBusy(false);
  }
  function historyStatus(message) {
    $("[data-history-status]").textContent = message;
    $("[data-history-status]").hidden = !message;
  }
  function updateHistoryControls() {
    const busy =
      historyLoading ||
      !!selectionRequest ||
      historyDeleting ||
      deleteConfirming;
    $("[data-history-edit]").hidden =
      !historyEditing && !historySessions.length;
    $("[data-history-edit]").textContent = historyEditing ? "완료" : "편집";
    $("[data-history-edit]").disabled = busy;
    $("[data-history-back]").disabled = historyDeleting || deleteConfirming;
    $("[data-new]").disabled = historyDeleting || deleteConfirming;
    $("[data-history-toggle]").disabled = historyDeleting || deleteConfirming;
    $("[data-history-more]").disabled = busy;
    $("[data-selection]").hidden = !historyEditing;
    $("[data-selection-footer]").hidden = !historyEditing || deleteConfirming;
    $("[data-delete-confirm]").hidden = !deleteConfirming;
    $("[data-select-all]").disabled = busy || !availableHistoryIds.size;
    const all =
      !!availableHistoryIds.size &&
      selectedHistoryIds.size === availableHistoryIds.size;
    $("[data-select-all]").setAttribute(
      "aria-checked",
      all ? "true" : selectedHistoryIds.size ? "mixed" : "false",
    );
    $("[data-selection-total]").textContent = selectionRequest
      ? "불러오는 중…"
      : `전체 ${availableHistoryIds.size}개`;
    $("[data-selection-count]").textContent =
      `${selectedHistoryIds.size}개 선택`;
    $("[data-history-delete]").disabled = busy || !selectedHistoryIds.size;
    for (const button of $("[data-history-list]").querySelectorAll("button")) {
      button.disabled = busy;
      if (historyEditing && button.dataset.historyDay) {
        const ids = selectionDays.get(button.dataset.historyDay) || new Set();
        const selected = [...ids].filter((id) =>
          selectedHistoryIds.has(id),
        ).length;
        button.setAttribute(
          "aria-checked",
          selected === ids.size && selected
            ? "true"
            : selected
              ? "mixed"
              : "false",
        );
        button.disabled = busy || !ids.size;
      } else if (historyEditing)
        button.setAttribute(
          "aria-checked",
          String(selectedHistoryIds.has(button.dataset.conversationId)),
        );
    }
  }
  function exitHistoryEdit() {
    if (historyDeleting) return;
    selectionRequest?.abort();
    selectionRequest = null;
    historyEditing = false;
    deleteConfirming = false;
    selectedHistoryIds.clear();
    availableHistoryIds.clear();
    selectionTimes.clear();
    selectionDays.clear();
    selectionOwner = null;
    renderSessions($("[data-history-list]"));
    updateHistoryControls();
  }
  async function editHistory() {
    if (historyEditing) {
      exitHistoryEdit();
      return;
    }
    if (historyLoading || historyDeleting) return;
    const task = new AbortController();
    selectionRequest = task;
    selectionOwner = account?.user?.id;
    historyEditing = true;
    selectedHistoryIds.clear();
    availableHistoryIds.clear();
    selectionTimes.clear();
    selectionDays.clear();
    renderSessions($("[data-history-list]"));
    updateHistoryControls();
    try {
      const rows = await listConversationSelection(selectionOwner, task.signal);
      if (selectionRequest !== task) return;
      if (
        !Array.isArray(rows) ||
        rows.some(
          (row) =>
            !row ||
            typeof row.id !== "string" ||
            !/^[a-f0-9-]{36}$/i.test(row.id) ||
            !Number.isFinite(Date.parse(row.updated_at)),
        )
      )
        throw new Error("history_unavailable");
      const ids = rows.map((row) => row.id);
      for (const row of rows) {
        selectionTimes.set(row.id, row.updated_at);
        const day = localDay(row.updated_at);
        if (!selectionDays.has(day)) selectionDays.set(day, new Set());
        selectionDays.get(day).add(row.id);
      }
      availableHistoryIds = new Set(ids);
      historySessions = historySessions.filter((session) =>
        availableHistoryIds.has(session.id),
      );
      renderSessions($("[data-history-list]"));
      historyStatus(ids.length ? "" : "아직 저장된 대화가 없어요.");
    } catch {
      if (selectionRequest !== task) return;
      exitHistoryEdit();
      historyStatus("대화 목록을 불러오지 못했어요. 다시 시도해 주세요.");
    } finally {
      if (selectionRequest === task) {
        selectionRequest = null;
        updateHistoryControls();
      }
    }
  }
  function forgetDeletedSessions(ids) {
    if (request && ids.has(request.thread.conversationId)) cancelRequest();
    for (const [key, value] of threads)
      if (ids.has(value.conversationId)) threads.delete(key);
    if (ids.has(thread.conversationId)) {
      thread = makeThread(general);
      threads.set(general.id + "\n" + general.text, thread);
    }
    historySessions = historySessions.filter((session) => !ids.has(session.id));
    for (const id of ids) {
      selectedHistoryIds.delete(id);
      availableHistoryIds.delete(id);
      selectionDays.get(localDay(selectionTimes.get(id)))?.delete(id);
      selectionTimes.delete(id);
    }
  }
  async function deleteSelectedHistory() {
    if (!deleteConfirming || !selectedHistoryIds.size || historyDeleting)
      return;
    const ids = [...selectedHistoryIds],
      owner = selectionOwner;
    deleteConfirming = false;
    historyDeleting = true;
    updateHistoryControls();
    historyStatus("대화를 삭제하고 있어요…");
    let deleted = 0,
      failed = false;
    if (request && selectedHistoryIds.has(request.thread.conversationId))
      cancelRequest();
    try {
      // Selection is an exact ID snapshot, including pages not loaded yet.
      // Batches keep requests bounded; confirmed batches survive a later failure.
      for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        const result = await deleteConversations(batch, owner);
        if (account?.user?.id !== owner) throw new Error("unauthenticated");
        if (
          !Array.isArray(result.deletedIds) ||
          result.deletedIds.some((id) => !batch.includes(id))
        )
          throw new Error("history_unavailable");
        const removed = new Set(result.deletedIds);
        deleted += removed.size;
        forgetDeletedSessions(removed);
        if (removed.size !== batch.length) failed = true;
      }
    } catch {
      failed = true;
    } finally {
      historyDeleting = false;
      if (account?.user?.id === owner) {
        if (!failed) exitHistoryEdit();
        render();
        await loadHistory();
        historyStatus(
          failed
            ? `${deleted ? `${deleted}개를 삭제했어요. ` : ""}남은 대화는 삭제를 확인하지 못했어요. 선택을 유지했으니 다시 시도해 주세요.`
            : `${deleted}개의 대화를 삭제했어요.`,
        );
        (failed
          ? $("[data-history-delete]")
          : historySessions.length
            ? $("[data-history-edit]")
            : $("[data-history-back]")
        ).focus({ preventScroll: true });
      } else {
        exitHistoryEdit();
        cancelHistory();
        threads.clear();
        historySessions = [];
        historyView = false;
        thread = getThread(general);
        render();
      }
    }
  }
  function renderSessions(container) {
    if (disposed) return;
    renderSessionList(container, {
      sessions: historySessions,
      editing: historyEditing,
      selectionTimes,
      selectionDays,
      selectedIds: selectedHistoryIds,
      currentId: thread?.conversationId,
      onSelect(id) {
        if (!historyEditing) return void openHistory(id);
        if (selectedHistoryIds.has(id)) selectedHistoryIds.delete(id);
        else selectedHistoryIds.add(id);
        updateHistoryControls();
      },
      onDay(day) {
        const ids = selectionDays.get(day) || new Set();
        const clear = [...ids].every((id) => selectedHistoryIds.has(id));
        for (const id of ids)
          if (clear) selectedHistoryIds.delete(id);
          else selectedHistoryIds.add(id);
        updateHistoryControls();
      },
    });
  }
  async function loadHistory(more = false) {
    if (disposed) return;
    cancelHistory();
    const task = new AbortController();
    historyRequest = task;
    const list = $("[data-history-list]"),
      scroll = $("[data-history-scroll]"),
      previousTop = scroll.scrollTop;
    if (!more) {
      historySessions = [];
      historyCursor = null;
      renderSessions(list);
    }
    $("[data-history-more]").hidden = true;
    historyBusy(true);
    historyStatus("대화 기록을 불러오고 있어요…");
    try {
      const rows = await listConversations(historyCursor, task.signal);
      if (historyRequest !== task) return;
      const page = rows.slice(0, 20),
        loaded = new Set(historySessions.map((session) => session.id));
      historyCursor = page.at(-1) || historyCursor;
      historySessions.push(
        ...page.filter(
          (session) =>
            !loaded.has(session.id) &&
            (!historyEditing || availableHistoryIds.has(session.id)),
        ),
      );
      renderSessions(list);
      $("[data-history-more]").hidden = rows.length <= 20;
      $("[data-history-more]").textContent = "이전 대화 불러오기";
      historyStatus(
        historySessions.length
          ? ""
          : "아직 저장된 대화가 없어요. 첫 질문을 시작해 보세요.",
      );
      scroll.scrollTop = more ? previousTop : 0;
    } catch {
      if (historyRequest !== task) return;
      historyStatus("대화 기록을 불러오지 못했어요. 다시 시도해 주세요.");
      $("[data-history-more]").hidden = false;
      $("[data-history-more]").textContent = "다시 불러오기";
    } finally {
      if (historyRequest === task) {
        historyRequest = null;
        historyBusy(false);
      }
    }
  }
  function unpackTurns(rows, newestFirst = true) {
    return (newestFirst ? rows.slice(0, 20).reverse() : rows).flatMap((t) => [
      { role: "user", text: t.question, createdAt: t.created_at, turnId: t.id },
      {
        role: "model",
        text: t.answer,
        createdAt: t.created_at,
        conversationId: t.conversation_id,
        question: t.question,
      },
    ]);
  }
  async function openHistory(id) {
    cancelHistory();
    const task = new AbortController();
    historyRequest = task;
    historyBusy(true);
    historyStatus("대화를 불러오고 있어요…");
    try {
      const [conversations, turns] = await loadConversation(id, task.signal);
      if (historyRequest !== task) return;
      if (!conversations[0]) throw new Error("history_unavailable");
      thread.draft = prompt.value;
      cancelRequest();
      thread = makeThread(conversations[0].context, id);
      thread.history = unpackTurns(turns);
      thread.saved = true;
      thread.oldestTurn = turns.slice(0, 20).at(-1) ?? null;
      thread.hasOlder = turns.length > 20;
      threads.set(thread.context.id + "\n" + thread.context.text, thread);
      if (threads.size > 20) threads.delete(threads.keys().next().value);
      historyView = false;
      render();
      $("#saa-ai-heading").focus({ preventScroll: true });
      requestAnimationFrame(() => {
        $("[data-scroll]").scrollTop = $("[data-scroll]").scrollHeight;
      });
    } catch {
      if (historyRequest === task)
        historyStatus("대화를 불러오지 못했어요. 다시 시도해 주세요.");
    } finally {
      if (historyRequest === task) {
        historyRequest = null;
        historyBusy(false);
      }
    }
  }
  async function loadOlder() {
    cancelHistory();
    const task = new AbortController(),
      target = thread;
    historyRequest = task;
    $("[data-older]").disabled = true;
    try {
      const turns = await listTurns(
        target.conversationId,
        target.oldestTurn,
        task.signal,
      );
      if (historyRequest !== task || thread !== target) return;
      const scroll = $("[data-scroll]"),
        height = scroll.scrollHeight;
      target.history.unshift(...unpackTurns(turns));
      target.hasOlder = turns.length > 20;
      target.oldestTurn = turns.slice(0, 20).at(-1) ?? target.oldestTurn;
      target.error = "";
      render();
      scroll.scrollTop += scroll.scrollHeight - height;
    } catch {
      if (historyRequest === task && thread === target) {
        target.error = "이전 대화를 불러오지 못했어요. 다시 시도해 주세요.";
        render();
      }
    } finally {
      if (historyRequest === task) historyRequest = null;
      $("[data-older]").disabled = false;
    }
  }
  async function retrySave() {
    const target = thread;
    if (target.saving) return;
    target.saving = true;
    render();
    try {
      while (target.unsaved.length) {
        await saveTurn(target.unsaved[0]);
        target.unsaved.shift();
        target.saved = true;
      }
    } catch (error) {
      // Ordinary failures remain retryable without spending AI quota. A deleted
      // session must never be recreated by retrying a stale answer.
      if (error.message === "conversation_deleted") {
        target.unsaved = [];
        target.deleted = true;
        target.error = errorMessages.conversation_deleted;
      }
    } finally {
      target.saving = false;
      if (thread === target) render();
    }
  }

  const errorMessages = {
    not_configured:
      "AI 어시스턴트 연결을 준비 중입니다. 잠시 후 다시 이용해 주세요.",
    not_ready:
      "AI 어시스턴트 연결을 준비 중입니다. 잠시 후 다시 이용해 주세요.",
    guest_disabled:
      "게스트 AI 연결을 준비 중입니다. GitHub로 로그인한 뒤 이용하거나 잠시 후 다시 시도해 주세요.",
    auth_unavailable:
      "사용자 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    unauthenticated:
      "사용자 연결이 만료되었습니다. 새로고침한 뒤 다시 이용해 주세요.",
    limit_reached:
      "게스트의 하루 AI 요청 한도에 도달했습니다. GitHub로 로그인하거나 한도가 초기화된 뒤 다시 이용해 주세요.",
    provider_limit:
      "AI 서비스의 공유 이용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
    provider_busy:
      "AI 서비스의 사용 한도 또는 일시적인 혼잡으로 응답하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    invalid_request:
      "질문이 너무 길거나 내용을 확인할 수 없습니다. 내용을 줄여 다시 전송해 주세요.",
    blocked:
      "이 질문에 답변을 제공하지 못했습니다. 학습 내용에 맞게 질문을 바꿔 주세요.",
    empty_response:
      "답변을 완성하지 못했습니다. 질문을 짧게 바꿔 다시 시도해 주세요.",
    context_full:
      "이 대화가 한 번에 참고할 수 있는 길이를 넘었어요. 이전 내용을 정리할 수 있으면 자동으로 요약합니다. 잠시 뒤 다시 보내거나, 필요한 조건을 새 대화에 적어 주세요.",
    context_changed:
      "이 대화의 학습 자료가 변경되었어요. 대화 기록에서 다시 열거나 새 대화를 시작해 주세요.",
    conversation_deleted: "삭제된 대화예요. 새 대화를 시작해 주세요.",
  };
  function begin(kind, question = "") {
    cancelRequest();
    thread.error = "";
    thread.suggestionError = false;
    const task = {
      kind,
      question,
      thread,
      createdAt: new Date().toISOString(),
      controller: new AbortController(),
    };
    // Transport/auth/database watchdog only; the server gives each model 5s.
    request = task;
    task.timer = setTimeout(() => task.controller.abort("timeout"), 120000);
    return task;
  }
  function failed(error, task) {
    if (request !== task) return;
    if (error.message === "history_unsaved") {
      // The header indicator represents pending saves; preserve the unsent
      // question so the next send can retry without losing conversation context.
      thread.error = "";
      thread.draft = task.question;
      return;
    }
    let message =
      errorMessages[error.message] ||
      (task.controller.signal.aborted
        ? "응답 시간이 길어졌습니다. 잠시 후 다시 전송해 주세요."
        : "AI에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.");
    if (error.retryAfter > 0) {
      const wait =
        error.retryAfter >= 3600
          ? `${Math.ceil(error.retryAfter / 3600)}시간`
          : `${Math.ceil(error.retryAfter / 60)}분`;
      message += ` 약 ${wait} 뒤 다시 시도할 수 있어요.`;
    }
    thread.error = message;
    thread.suggestionError = task.kind === "suggestions";
    if (task.kind === "chat") thread.draft = task.question;
  }
  async function suggestions() {
    const task = begin("suggestions");
    render();
    try {
      const data = await call(
        { action: "suggestions", context: task.thread.suggestionContext },
        task,
      );
      if (
        !Array.isArray(data.questions) ||
        data.questions.length !== 4 ||
        data.questions.some(
          (q) => typeof q !== "string" || !q.trim() || q.length > 150,
        )
      )
        throw new Error("empty_response");
      if (request === task) thread.suggestions = data.questions;
    } catch (error) {
      failed(error, task);
    } finally {
      clearTimeout(task.timer);
      if (request === task) {
        request = null;
        render();
      }
    }
  }
  async function send(event) {
    event.preventDefault();
    const question = prompt.value.trim();
    if (!question || request?.kind === "chat") return;
    const task = begin("chat", question);
    task.turnId = crypto.randomUUID();
    thread.draft = "";
    render();
    $("[data-scroll]").scrollTop = $("[data-scroll]").scrollHeight;
    try {
      // The server builds member context from saved turns. Do not silently omit
      // an answer that is still waiting for the existing idempotent save retry.
      if (
        account?.user &&
        account.user.is_anonymous !== true &&
        task.thread.unsaved.length
      ) {
        await retrySave();
        if (task.thread.unsaved.length) throw new Error("history_unsaved");
      }
      if (task.thread.deleted) throw new Error("conversation_deleted");
      const data = await call(
        {
          action: "chat",
          context: task.thread.context,
          question,
          conversationId: task.thread.conversationId,
          turnId: task.turnId,
          history: task.thread.history
            .slice(-6)
            .map((m) => ({ role: m.role, text: m.text.slice(0, 2000) })),
        },
        task,
      );
      if (
        typeof data.answer !== "string" ||
        !data.answer.trim() ||
        data.answer.length > 14000
      )
        throw new Error("empty_response");
      if (request === task) {
        const createdAt = data.createdAt || task.createdAt;
        thread.history.push(
          { role: "user", text: question, createdAt },
          { role: "model", text: data.answer, createdAt },
        );
        if (data.saved === true) thread.saved = true;
        if (data.saved === false)
          thread.unsaved.push({
            conversationId: thread.conversationId,
            turnId: task.turnId,
            context: thread.context,
            question: question,
            answer: data.answer,
            createdAt: data.createdAt,
          });
      }
    } catch (error) {
      failed(error, task);
    } finally {
      clearTimeout(task.timer);
      if (request === task) {
        request = null;
        render();
        if (historyView) void loadHistory();
        else
          requestAnimationFrame(() => {
            $("[data-scroll]").scrollTop = $("[data-scroll]").scrollHeight;
          });
      }
    }
  }
  fab.onclick = () => (panel.hidden ? open(null, fab) : close());
  $("[data-context-link]").onclick = (event) => {
    const href = event.currentTarget.getAttribute("href");
    if (!href || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    hideTooltip();
    navigation.navigate(href);
  };
  $("[data-close]").onclick = close;
  $("[data-new]").onclick = () => {
    if (historyDeleting) return;
    exitHistoryEdit();
    cancelRequest();
    cancelHistory();
    historyView = false;
    threads.delete(general.id + "\n" + general.text);
    thread = getThread(general);
    render();
    prompt.focus({ preventScroll: true });
  };
  function returnToChat() {
    if (historyDeleting) return;
    exitHistoryEdit();
    cancelHistory();
    historyView = false;
    render();
    $("#saa-ai-heading").focus({ preventScroll: true });
  }
  $("[data-history-toggle]").onclick = () => {
    if (historyView) return returnToChat();
    thread.draft = prompt.value;
    historyView = true;
    render();
    $("[data-history-back]").focus({ preventScroll: true });
    void loadHistory();
  };
  $("[data-history-back]").onclick = returnToChat;
  $("[data-history-more]").onclick = () => void loadHistory(!!historyCursor);
  $("[data-history-edit]").onclick = () => void editHistory();
  $("[data-select-all]").onclick = () => {
    selectedHistoryIds =
      selectedHistoryIds.size === availableHistoryIds.size
        ? new Set()
        : new Set(availableHistoryIds);
    updateHistoryControls();
  };
  $("[data-history-delete]").onclick = () => {
    if (!selectedHistoryIds.size || historyDeleting) return;
    deleteConfirming = true;
    $("#saa-ai-delete-title").textContent =
      `대화 ${selectedHistoryIds.size}개를 삭제할까요?`;
    updateHistoryControls();
    $("[data-delete-cancel]").focus({ preventScroll: true });
  };
  $("[data-delete-cancel]").onclick = () => {
    deleteConfirming = false;
    updateHistoryControls();
    $("[data-history-delete]").focus({ preventScroll: true });
  };
  $("[data-delete-confirm-button]").onclick = () =>
    void deleteSelectedHistory();
  $("[data-older]").onclick = () => void loadOlder();
  saveError.onpointerenter = (event) => {
    if (event.pointerType !== "touch") showTooltip(saveError);
  };
  saveError.onpointerleave = () => {
    if (!saveError.matches(":focus-visible")) hideTooltip();
  };
  saveError.onfocus = () => {
    if (saveError.matches(":focus-visible")) showTooltip(saveError);
  };
  saveError.onblur = hideTooltip;
  saveError.onclick = () => showTooltip(saveError);
  Promise.resolve(account?.ready).then(() => {
    if (disposed) return;
    $("[data-history-toggle]").hidden =
      !account?.user || account.user.is_anonymous === true;
  });
  $("[data-retry]").onclick = () => void suggestions();
  $("form").onsubmit = send;
  prompt.oninput = updateComposer;
  prompt.addEventListener(
    "keydown",
    (event) => {
      // Keep touch keyboards' Enter behavior and never submit an IME confirmation.
      if (
        !keyboardSubmit.matches ||
        event.key !== "Enter" ||
        event.shiftKey ||
        event.isComposing ||
        event.keyCode === 229
      )
        return;
      event.preventDefault();
      if (!event.repeat) prompt.form.requestSubmit();
    },
    { signal: lifetime.signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") hideTooltip();
      if (panel.hidden || document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (deleteConfirming) $("[data-delete-cancel]").click();
        else close();
      }
      if (panel.contains(event.target)) event.stopPropagation();
      if (event.key === "Tab" && mobile.matches) {
        const focusable = [
          ...panel.querySelectorAll("button:not(:disabled),textarea,a[href]"),
        ].filter((el) => el.getClientRects().length && !el.closest("[inert]"));
        const first = focusable[0],
          last = focusable.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === $("#saa-ai-heading"))
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    { signal: lifetime.signal },
  );
  document.addEventListener("scroll", hideTooltip, {
    capture: true,
    passive: true,
    signal: lifetime.signal,
  });
  window.addEventListener("resize", hideTooltip, {
    passive: true,
    signal: lifetime.signal,
  });
  window.addEventListener("hashchange", locationChanged, {
    signal: lifetime.signal,
  });
  mobile.addEventListener("change", modalState, { signal: lifetime.signal });
  navigation.restore();
  return {
    open,
    showTooltip,
    hideTooltip,
    locationChanged,
    dispose() {
      disposed = true;
      lifetime.abort();
      navigation.dispose();
      layout.dispose();
      cancelRequest();
      cancelHistory();
      selectionRequest?.abort();
      panel.hidden = true;
      document.body.classList.remove("saa-ai-open");
      modalState();
      hideTooltip();
      disposeViews(panel);
    },
  };
}
