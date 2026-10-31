"use client";
import { createContext, useContext } from "react";
import { AssistantIcon } from "./icon";
import { contextForItem } from "@/lib/study/assistant-context";
export const AssistantContext = createContext(null);
export function AIButton({ context }) {
  const assistant = useContext(AssistantContext);
  if (!assistant) return null;
  return (
    <button
      type="button"
      className="saa-ai-trigger"
      data-ai-ui
      aria-label="이 항목을 AI에 질문"
      onPointerEnter={(e) => {
        if (e.pointerType !== "touch") assistant.showTooltip(e.currentTarget);
      }}
      onPointerLeave={(e) => {
        if (!(
          document.activeElement === e.currentTarget &&
          e.currentTarget.matches(":focus-visible")
        ))
          assistant.hideTooltip();
      }}
      onFocus={(e) => {
        if (e.currentTarget.matches(":focus-visible"))
          assistant.showTooltip(e.currentTarget);
      }}
      onBlur={assistant.hideTooltip}
      onClick={(e) =>
        assistant.open(
          contextForItem(context, e.currentTarget),
          e.currentTarget,
        )
      }
    >
      <AssistantIcon name="robot" />
    </button>
  );
}
