import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AssistantIcon } from "./icon";

export function useSessionTitleEditor({ session, disabled, onRename, onSuggest }) {
  const [mode, setMode] = useState(null),
    [draft, setDraft] = useState(""),
    [original, setOriginal] = useState(""),
    [working, setWorking] = useState(""),
    [error, setError] = useState("");
  const task = useRef(null), input = useRef(null), editButton = useRef(null), aiButton = useRef(null);
  useEffect(() => () => task.current?.abort(), []);
  useLayoutEffect(() => {
    if (mode === "manual" && input.current) {
      input.current.focus({ preventScroll: true });
      input.current.select();
    }
  }, [mode]);
  useLayoutEffect(() => {
    if (input.current) {
      input.current.style.height = "0px";
      input.current.style.height = `${input.current.scrollHeight}px`;
    }
  }, [draft, mode]);
  const restoreFocus = () => requestAnimationFrame(() =>
    (mode === "ai" ? aiButton : editButton).current?.focus({ preventScroll: true }));
  function cancel() {
    task.current?.abort();
    task.current = null;
    setMode(null);
    setWorking("");
    setError("");
    restoreFocus();
  }
  function begin(nextMode) {
    setOriginal(session.title);
    setDraft(nextMode === "ai" ? "" : session.title);
    setMode(nextMode);
    setError("");
  }
  function failure(cause, generating) {
    const messages = {
      title_changed: "다른 곳에서 제목이 변경됐어요. 취소한 뒤 목록을 다시 열어주세요.",
      conversation_deleted: "삭제되었거나 사용할 수 없는 대화예요.",
      title_empty: "아직 저장된 질문과 답변이 없어 제목을 제안할 수 없어요.",
      member_required: "계정을 연동한 사용자만 이용할 수 있어요.",
      unauthenticated: "계정 연결을 확인한 뒤 다시 시도해 주세요.",
      provider_limit: "AI 사용 한도에 도달했어요. 잠시 후 다시 시도해 주세요.",
      provider_busy: "AI가 응답하지 못했어요. 잠시 후 다시 시도해 주세요.",
    };
    setError(messages[cause.message] || (generating
      ? "제목을 제안하지 못했어요. 취소한 뒤 다시 시도해 주세요."
      : "제목을 저장하지 못했어요. 다시 확인해 주세요."));
  }
  async function suggest() {
    if (disabled || task.current) return;
    begin("ai");
    const controller = new AbortController();
    task.current = controller;
    setWorking("generate");
    try {
      const result = await onSuggest(session.id, controller.signal, (text) => {
        if (task.current === controller && !controller.signal.aborted) setDraft(text);
      });
      if (task.current !== controller || controller.signal.aborted) return;
      if (typeof result?.title !== "string" || !result.title.trim() || result.title.length > 100)
        throw new Error("empty_response");
      setDraft(result.title);
    } catch (cause) {
      if (task.current === controller && !controller.signal.aborted) {
        setDraft(""); // A partial or failed stream is never a confirmable proposal.
        failure(cause, true);
      }
    } finally {
      if (task.current === controller) { task.current = null; setWorking(""); }
    }
  }
  async function confirm() {
    if (disabled || task.current || !draft.trim()) return;
    const controller = new AbortController();
    task.current = controller;
    setWorking("save");
    setError("");
    try {
      await onRename(session.id, draft.trim(), original, controller.signal);
      if (task.current !== controller || controller.signal.aborted) return;
      setMode(null);
      restoreFocus();
    } catch (cause) {
      if (task.current === controller && !controller.signal.aborted) failure(cause, false);
    } finally {
      if (task.current === controller) { task.current = null; setWorking(""); }
    }
  }
  function keyDown(event) {
    if (!mode) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      event.stopPropagation();
      return;
    }
    if (event.target === input.current && event.key === "Enter") event.preventDefault();
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      if (working !== "save") cancel();
    }
  }
  const title = mode === "manual" ? (
    <textarea ref={input} className="saa-ai-title-input" aria-label="대화 제목" rows={1}
      value={draft} maxLength={100} readOnly={!!working} disabled={disabled}
      onChange={(event) => setDraft(event.target.value.replace(/[\r\n]+/g, " "))} />
  ) : (
    <strong className="saa-ai-session-title" aria-busy={working === "generate"}>
      {mode === "ai" && working === "generate" && !draft
        ? <span className="saa-ai-loading saa-ai-title-wait" role="status" aria-label="제목 생성 중" />
        : mode === "ai" && draft ? draft : session.title || "저장된 대화"}
    </strong>
  );
  const controls = (
    <div className="saa-ai-title-tools" aria-busy={!!working}>
      {mode ? <>
        <button type="button" title="취소" aria-label="취소" disabled={working === "save"} onClick={cancel}>
          <AssistantIcon name="close" />
        </button>
        <button type="button" className="saa-ai-title-confirm" title="확인" aria-label="확인"
          disabled={disabled || !!working || !draft.trim()} onClick={confirm}><AssistantIcon name="check" /></button>
      </> : <>
        <button ref={editButton} type="button" title="제목 수정" aria-label="제목 수정"
          disabled={disabled} onClick={() => begin("manual")}><AssistantIcon name="edit" /></button>
        <button ref={aiButton} type="button" title="AI로 제목 제안" aria-label="AI로 제목 제안"
          disabled={disabled} onClick={suggest}><AssistantIcon name="magic-edit" /></button>
      </>}
      {working === "save" && <span className="saa-ai-sr" role="status">제목을 저장하고 있어요.</span>}
    </div>
  );
  return { title, controls, renaming: !!mode, keyDown,
    error: error && <p className="saa-ai-title-error" role="alert">{error}</p> };
}
