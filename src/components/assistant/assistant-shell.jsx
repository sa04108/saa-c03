"use client";
import { memo, useEffect, useRef } from "react";
import { AssistantIcon } from "./icon";
import { createAssistantController } from "./controller";
import { getAccount } from "@/lib/backend/account";

export const AssistantShell = memo(function AssistantShell({ onReady }) {
  const fab = useRef(null),
    panel = useRef(null),
    tooltip = useRef(null);
  useEffect(() => {
    const controller = createAssistantController({
      fab: fab.current,
      panel: panel.current,
      tooltip: tooltip.current,
      account: getAccount(),
    });
    onReady(controller);
    return () => {
      onReady(null);
      controller.dispose();
    };
  }, [onReady]);
  return (
    <>
      <button
        ref={fab}
        type="button"
        className="saa-ai-fab"
        data-ai-ui
        aria-controls="saa-assistant"
        aria-expanded="false"
        aria-label="AI 어시스턴트 열기"
      >
        <AssistantIcon name="robot" />
        <span>AI 어시스턴트</span>
      </button>
      <section
        ref={panel}
        className="saa-ai"
        id="saa-assistant"
        data-ai-ui
        hidden
        role="dialog"
        aria-labelledby="saa-ai-heading"
      >
        <header className="saa-ai-head">
          <h2 className="saa-ai-type" id="saa-ai-heading" tabIndex="-1">
            <AssistantIcon name="book" />
            <span data-context-type>자유 질문</span>
          </h2>
          <div className="saa-ai-head-tools">
            <button
              type="button"
              className="saa-ai-save-error"
              data-save-error
              aria-label="기록 저장 불가"
              hidden
            >
              <AssistantIcon name="wifi-off" />
            </button>
            <div className="saa-ai-head-actions">
              <button
                type="button"
                className="saa-ai-icon"
                data-history-toggle
                aria-label="대화 기록"
                title="대화 기록"
                aria-pressed="false"
                hidden
              >
                <AssistantIcon name="history" />
              </button>
              <button
                type="button"
                className="saa-ai-icon"
                data-new
                aria-label="새 대화"
                title="새 대화"
              >
                <AssistantIcon name="edit" />
              </button>
              <button
                type="button"
                className="saa-ai-icon"
                data-close
                aria-label="AI 어시스턴트 닫기"
                title="닫기"
              >
                <AssistantIcon name="close" />
              </button>
            </div>
          </div>
        </header>
        <section
          className="saa-ai-history"
          data-history
          hidden
          aria-label="대화 기록"
        >
          <div className="saa-ai-history-head">
            <div className="saa-ai-history-tools">
              <button
                type="button"
                className="saa-ai-history-back"
                data-history-back
              >
                <AssistantIcon name="arrow" />
                대화로 돌아가기
              </button>
              <button
                type="button"
                className="saa-ai-history-edit"
                data-history-edit
                hidden
              >
                편집
              </button>
            </div>
            <div className="saa-ai-selection" data-selection hidden>
              <button
                type="button"
                className="saa-ai-select-all"
                data-select-all
                role="checkbox"
                aria-checked="false"
              >
                <span className="saa-ai-check" aria-hidden="true">
                  <AssistantIcon name="check" />
                </span>
                전체 선택
              </button>
              <span data-selection-total></span>
            </div>
            <p
              className="saa-ai-feedback"
              data-history-status
              role="status"
              hidden
            ></p>
          </div>
          <div className="saa-ai-history-scroll" data-history-scroll>
            <div
              className="saa-ai-sessions"
              data-history-list
              role="list"
              aria-label="저장된 대화 세션"
            ></div>
            <button
              type="button"
              className="saa-ai-retry saa-ai-history-more"
              data-history-more
              hidden
            >
              이전 대화 불러오기
            </button>
          </div>
          <div className="saa-ai-history-footer" data-selection-footer hidden>
            <span data-selection-count role="status" aria-live="polite">
              0개 선택
            </span>
            <button
              type="button"
              className="saa-ai-delete"
              data-history-delete
              disabled
            >
              <AssistantIcon name="trash" />
              선택 삭제
            </button>
          </div>
          <section
            className="saa-ai-delete-confirm"
            data-delete-confirm
            role="alertdialog"
            aria-labelledby="saa-ai-delete-title"
            aria-describedby="saa-ai-delete-description"
            hidden
          >
            <h3 id="saa-ai-delete-title"></h3>
            <p id="saa-ai-delete-description">
              선택한 대화와 메시지는 복구할 수 없어요.
            </p>
            <div>
              <button
                type="button"
                className="saa-ai-delete-cancel"
                data-delete-cancel
              >
                취소
              </button>
              <button
                type="button"
                className="saa-ai-delete"
                data-delete-confirm-button
              >
                삭제
              </button>
            </div>
          </section>
        </section>
        <div className="saa-ai-scroll" data-scroll>
          <div className="saa-ai-welcome" data-welcome>
            <p className="saa-ai-eyebrow">YOUR STUDY COMPANION</p>
            <h3 data-welcome-title></h3>
            <p className="saa-ai-description">
              질문을 고르거나 직접 입력해 보세요.
            </p>
            <div
              className="saa-ai-suggestions"
              data-suggestions
              aria-label="예상 질문"
            ></div>
            <p className="saa-ai-suggestions-note" data-suggestion-note hidden>
              <AssistantIcon name="edit" />
              질문을 선택하면 입력창에만 채워져요.
            </p>
          </div>
          <button
            type="button"
            className="saa-ai-retry saa-ai-older"
            data-older
            hidden
          >
            이전 대화 보기
          </button>
          <div
            className="saa-ai-messages"
            data-messages
            role="log"
            aria-label="대화 내용"
            aria-live="polite"
          ></div>
          <p className="saa-ai-feedback" data-feedback role="status" hidden></p>
          <button type="button" className="saa-ai-retry" data-retry hidden>
            예상 질문 다시 불러오기
          </button>
          <p className="saa-ai-image-note" data-image-note hidden>
            이미지 속 내용이 필요하면 질문에 함께 적어 주세요.
          </p>
        </div>
        <form className="saa-ai-composer-zone">
          <div className="saa-ai-composer">
            <label className="saa-ai-sr" htmlFor="saa-ai-prompt">
              AI 어시스턴트에게 질문
            </label>
            <textarea
              id="saa-ai-prompt"
              rows="1"
              placeholder="궁금한 내용을 입력하세요…"
              maxLength="2000"
            ></textarea>
            <button
              className="saa-ai-send"
              type="submit"
              disabled
              aria-label="질문 전송"
            >
              <AssistantIcon name="up" />
            </button>
          </div>
        </form>
      </section>
      <div
        ref={tooltip}
        id="saa-ai-tooltip"
        className="saa-ai-tooltip"
        data-ai-ui
        role="tooltip"
        hidden
      />
    </>
  );
});
