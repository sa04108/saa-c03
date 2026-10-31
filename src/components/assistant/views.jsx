import { Fragment, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { AssistantIcon } from "./icon";

// The controller owns request/focus lifetimes; these isolated slots own their React children.
const roots = new Map();
function paint(container, view) {
  if (!roots.has(container)) roots.set(container, createRoot(container));
  flushSync(() => roots.get(container).render(view));
}
export function disposeViews(panel) {
  for (const [container, root] of roots)
    if (panel.contains(container)) {
      roots.delete(container);
      // Parent effect cleanup can run during a React commit.
      queueMicrotask(() => root.unmount());
    }
}
export function localDay(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
function dayLabel(value) {
  const date = new Date(value),
    now = new Date(),
    yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const day = localDay(value),
    prefix =
      day === localDay(now)
        ? "오늘 · "
        : day === localDay(yesterday)
          ? "어제 · "
          : "";
  return (
    prefix +
    new Intl.DateTimeFormat("ko-KR", {
      ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
      month: "long",
      day: "numeric",
      weekday: "short",
    }).format(date)
  );
}
function Time({ value }) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return (
    <time dateTime={value} title={date.toLocaleString("ko-KR")}>
      {new Intl.DateTimeFormat("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(date)}
    </time>
  );
}
function Inline({ text }) {
  const pattern =
    /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https:\/\/[^\s)]+\))/g;
  let offset = 0;
  const children = [];
  for (const match of text.matchAll(pattern)) {
    children.push(text.slice(offset, match.index));
    const value = match[0];
    if (value.startsWith("**"))
      children.push(<strong key={match.index}>{value.slice(2, -2)}</strong>);
    else if (value.startsWith("`"))
      children.push(<code key={match.index}>{value.slice(1, -1)}</code>);
    else {
      const parts = /^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/.exec(value);
      children.push(
        <a
          key={match.index}
          href={parts[2]}
          target="_blank"
          rel="noopener noreferrer"
        >
          {parts[1]}
        </a>,
      );
    }
    offset = match.index + value.length;
  }
  children.push(text.slice(offset));
  return children;
}
export function AssistantAnswer({ text }) {
  return (
    <div className="saa-ai-answer">
      {text.split(/\n\s*\n/).map((block, i) => {
        const lines = block.split("\n");
        return lines.every((line) => /^\s*[-*] /.test(line)) ? (
          <ul key={i}>
            {lines.map((line, j) => (
              <li key={j}>
                <Inline text={line.replace(/^\s*[-*] /, "")} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            <Inline text={block.replace(/^#{1,6} /gm, "")} />
          </p>
        );
      })}
    </div>
  );
}
export function ChatMessages({ messages }) {
  let day = "";
  return messages.map((message, i) => {
    const next = localDay(message.createdAt),
      divider = next && next !== day;
    if (next) day = next;
    return (
      <Fragment
        key={`${message.turnId || message.createdAt || i}-${message.role}-${i}`}
      >
        {divider && (
          <div className="saa-ai-date">
            <time dateTime={next}>{dayLabel(message.createdAt)}</time>
          </div>
        )}
        <div
          className={`saa-ai-message${message.role === "user" ? " saa-ai-user" : ""}`}
          data-turn-id={message.role === "user" ? message.turnId : undefined}
          aria-label={message.role === "user" ? "내 질문" : undefined}
        >
          {message.role === "user" ? (
            message.text
          ) : (
            <>
              <div className="saa-ai-reply-label">
                <AssistantIcon name="robot" />
                AI 어시스턴트{next && <Time value={message.createdAt} />}
              </div>
              <AssistantAnswer text={message.text} />
            </>
          )}
        </div>
      </Fragment>
    );
  });
}
function Suggestions({ questions, onSelect }) {
  const [selected, setSelected] = useState(null);
  return questions.map((question) => (
    <button
      type="button"
      className="saa-ai-suggestion"
      key={question}
      aria-pressed={selected === question}
      onClick={() => {
        setSelected(question);
        onSelect(question);
      }}
    >
      <span>{question}</span>
      <AssistantIcon name="arrow" />
    </button>
  ));
}
export function ConversationList({
  sessions,
  editing,
  selectionTimes,
  selectionDays,
  selectedIds,
  currentId,
  onSelect,
  onDay,
}) {
  const stamp = (session) =>
    editing
      ? selectionTimes.get(session.id) || session.updated_at
      : session.updated_at;
  const ordered = editing
    ? [...sessions].sort(
        (a, b) =>
          Date.parse(stamp(b)) - Date.parse(stamp(a)) ||
          b.id.localeCompare(a.id),
      )
    : sessions;
  let day = "";
  return ordered.map((session) => {
    const updatedAt = stamp(session),
      next = localDay(updatedAt),
      divider = next && next !== day;
    if (next) day = next;
    const kind =
        session.kind === "concept"
          ? "개념"
          : session.kind === "question"
            ? "문제"
            : "자유 질문",
      title = session.title || "저장된 대화",
      topic = session.context_title || "SAA-C03 · 자유 질문";
    return (
      <Fragment key={session.id}>
        {divider &&
          (editing ? (
            <div role="listitem">
              <button
                type="button"
                className="saa-ai-date-select"
                data-history-day={next}
                role="checkbox"
                aria-checked="false"
                aria-label={`${dayLabel(updatedAt)}의 대화 모두 선택`}
                onClick={() => onDay(next)}
              >
                <span className="saa-ai-check" aria-hidden="true">
                  <AssistantIcon name="check" />
                </span>
                <time dateTime={next}>{dayLabel(updatedAt)}</time>
                <span className="saa-ai-date-count">
                  {selectionDays.get(next)?.size || 0}개
                </span>
              </button>
            </div>
          ) : (
            <div className="saa-ai-session-date" role="presentation">
              <time dateTime={next}>{dayLabel(updatedAt)}</time>
            </div>
          ))}
        <div role="listitem">
          <button
            type="button"
            className="saa-ai-session"
            data-conversation-id={session.id}
            aria-current={
              !editing && session.id === currentId ? "true" : undefined
            }
            role={editing ? "checkbox" : undefined}
            aria-checked={editing ? selectedIds.has(session.id) : undefined}
            aria-label={`${title} — ${topic} ${editing ? "선택" : "대화 이어가기"}`}
            onClick={() => onSelect(session.id)}
          >
            <span
              className={editing ? "saa-ai-check" : "saa-ai-session-icon"}
              aria-hidden="true"
            >
              <AssistantIcon
                name={
                  editing
                    ? "check"
                    : session.kind === "general"
                      ? "robot"
                      : "book"
                }
              />
            </span>
            <span className="saa-ai-session-copy">
              <span className="saa-ai-session-meta">
                <span>{kind}</span>
                <Time value={updatedAt} />
              </span>
              <strong>{title}</strong>
              <span className="saa-ai-session-topic">{topic}</span>
            </span>
            {!editing && (
              <span className="saa-ai-session-arrow">
                <AssistantIcon name="arrow" />
              </span>
            )}
          </button>
        </div>
      </Fragment>
    );
  });
}
export const renderMessages = (container, messages) =>
  paint(container, <ChatMessages messages={messages} />);
export const renderSuggestions = (container, questions, onSelect) =>
  paint(
    container,
    <Suggestions
      key={questions.join("\n")}
      questions={questions}
      onSelect={onSelect}
    />,
  );
export const renderSessions = (container, props) =>
  paint(container, <ConversationList {...props} />);
