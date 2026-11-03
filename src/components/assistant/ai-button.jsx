"use client";
import { createContext, useContext } from "react";
import { AssistantIcon } from "./icon";
import { contextForItem } from "@/lib/study/assistant-context";
export const AssistantContext = createContext(null);
export function AIButton({ context, label, question }) {
  const assistant = useContext(AssistantContext);
  if (!assistant) return null;
  return (
    <button
      type="button"
      className={`saa-ai-trigger${label ? " saa-ai-trigger-inline" : ""}`}
      data-ai-ui
      lang="ko"
      aria-label={label || "이 항목을 AI에 질문"}
      onPointerEnter={(e) => {
        if (!label && e.pointerType !== "touch") assistant.showTooltip(e.currentTarget);
      }}
      onPointerLeave={(e) => {
        if (!(
          document.activeElement === e.currentTarget &&
          e.currentTarget.matches(":focus-visible")
        ))
          assistant.hideTooltip();
      }}
      onFocus={(e) => {
        if (!label && e.currentTarget.matches(":focus-visible"))
          assistant.showTooltip(e.currentTarget);
      }}
      onBlur={assistant.hideTooltip}
      onClick={(e) =>
        assistant.open(
          contextForItem(context, e.currentTarget),
          e.currentTarget,
          contextForItem(context, e.currentTarget, { includeAnswers: false }),
          question,
        )
      }
    >
      <AssistantIcon name="robot" />
      {label && <span>{label}</span>}
    </button>
  );
}
