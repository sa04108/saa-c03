import { useEffect, useRef, useState } from "react";
import { AssistantIcon } from "./icon";

export function SessionTitleEditor({ session, disabled, onRename, onSuggest, onEditingChange }) {
  const [draft, setDraft] = useState(null),
    [original, setOriginal] = useState(""),
    [working, setWorking] = useState(""),
    [ai, setAI] = useState(false),
    [error, setError] = useState("");
  const task = useRef(null), editButton = useRef(null), aiButton = useRef(null);
  useEffect(() => () => task.current?.abort(), []);
  const restoreFocus = () => requestAnimationFrame(() =>
    (ai ? aiButton : editButton).current?.focus({ preventScroll: true }));
  function cancel() {
    task.current?.abort();
    task.current = null;
    setDraft(null);
    setWorking("");
    setError("");
    onEditingChange(false);
    restoreFocus();
  }
  function begin(useAI) {
    setOriginal(session.title);
    setDraft(session.title);
    setAI(useAI);
    setError("");
    onEditingChange(true);
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
      ? "제목을 제안하지 못했어요. 직접 수정하거나 다시 시도해 주세요."
      : "제목을 저장하지 못했어요. 다시 확인해 주세요."));
  }
  async function suggest() {
    if (disabled || task.current) return;
    begin(true);
    const controller = new AbortController();
    task.current = controller;
    setWorking("generate");
    try {
      const result = await onSuggest(session.id, controller.signal);
      if (task.current !== controller || controller.signal.aborted) return;
      if (typeof result?.title !== "string" || !result.title.trim() || result.title.length > 100)
        throw new Error("empty_response");
      setDraft(result.title);
    } catch (cause) {
      if (task.current === controller && !controller.signal.aborted) failure(cause, true);
    } finally {
      if (task.current === controller) { task.current = null; setWorking(""); }
    }
  }
  async function confirm(event) {
    event.preventDefault();
    if (disabled || task.current || !draft?.trim()) return;
    const controller = new AbortController();
    task.current = controller;
    setWorking("save");
    setError("");
    try {
      await onRename(session.id, draft.trim(), original, controller.signal);
      if (task.current !== controller || controller.signal.aborted) return;
      setDraft(null);
      onEditingChange(false);
      restoreFocus();
    } catch (cause) {
      if (task.current === controller && !controller.signal.aborted) failure(cause, false);
    } finally {
      if (task.current === controller) { task.current = null; setWorking(""); }
    }
  }
  return draft === null ? (
    <div className="saa-ai-title-tools">
      <button ref={editButton} type="button" title="제목 수정" aria-label="제목 수정"
        disabled={disabled} onClick={() => begin(false)}><AssistantIcon name="edit" /></button>
      <button ref={aiButton} type="button" title="AI로 제목 제안" aria-label="AI로 제목 제안"
        disabled={disabled} onClick={suggest}><AssistantIcon name="magic-edit" /></button>
    </div>
  ) : (
    <form className="saa-ai-title-editor" onSubmit={confirm} aria-busy={!!working}>
      <input aria-label="대화 제목" value={draft} maxLength={100} required autoFocus={!ai}
        readOnly={!!working} disabled={disabled} onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) {
            event.stopPropagation();
            return;
          }
          // Enter in the input must not save implicitly; activate Confirm explicitly.
          if (event.key === "Enter") event.preventDefault();
          if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation();
            if (working !== "save") cancel();
          }
        }} />
      {(working || (ai && !error)) && <p className="saa-ai-title-note" role="status">{working === "generate"
        ? "AI가 제목을 제안하고 있어요…" : working === "save"
          ? "제목을 저장하고 있어요…" : "AI 제안 · 확인하면 저장됩니다."}</p>}
      {error && <p className="saa-ai-title-error" role="alert">{error}</p>}
      <div className="saa-ai-title-confirm">
        <button type="button" disabled={working === "save"} onClick={cancel}>취소</button>
        <button type="submit" title="확인" aria-label="확인"
          disabled={disabled || !!working || !draft.trim()}><AssistantIcon name="check" /></button>
      </div>
    </form>
  );
}
