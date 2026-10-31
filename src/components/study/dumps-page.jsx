"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "../account-provider";
import { StudyHeader } from "../study-header";
import { createStudySession } from "@/lib/study/session";
import { QuestionCard } from "./question-card";
import { ProgressSidebar } from "./progress-sidebar";
import { BackupDialog } from "./backup-dialog";
import bank from "@/data/questions.json";
import notes from "@/data/explanations.json";

export function DumpsPage({ embedded = null }) {
  const { initialized, service, offline } = useAccount();
  const [view, setView] = useState(null),
    [actions, setActions] = useState(null),
    [expanded, setExpanded] = useState(false),
    [toast, setToast] = useState("");
  const dialog = useRef(null),
    main = useRef(null),
    toastTimer = useRef(null),
    focusQuestion = useRef(false);
  const notify = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    if (!initialized) return;
    const session = createStudySession({
      bank,
      notes,
      account: service,
      embedded,
      onChange: setView,
      notify,
    });
    setActions(session);
    setView(session.snapshot());
    return () => session.dispose();
  }, [initialized, service, embedded, notify]);
  useEffect(() => {
    if (!focusQuestion.current || !view) return;
    focusQuestion.current = false;
    main.current.scrollIntoView({ behavior: "auto", block: "start" });
    main.current
      .querySelector("#question-title")
      ?.focus({ preventScroll: true });
  }, [view?.state.current]);
  function go(id, jump = false) {
    if (!actions) return;
    focusQuestion.current = true;
    setExpanded(false);
    jump ? actions.jump(id) : actions.go(id);
  }
  function navigate(delta) {
    if (view) go(view.ids[view.index + delta]);
  }
  useEffect(() => {
    if (!actions || view?.loading) return;
    const keyboard = (e) => {
      if (
        e.defaultPrevented ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        dialog.current?.open ||
        document.body.classList.contains("saa-ai-open") ||
        /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)
      )
        return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        focusQuestion.current = true;
        setExpanded(false);
        actions.navigate(e.key === "ArrowLeft" ? -1 : 1);
      } else if (/^[a-f]$/i.test(e.key)) actions.select(e.key.toUpperCase());
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [actions, view?.loading]);
  return (
    <div data-page="dumps">
      <StudyHeader
        page="dumps"
        status={view?.status || "저장 상태 확인 중"}
        statusError={view?.storageError || !!view?.warning}
        onSettings={() => dialog.current.showModal()}
      />
      <div
        id="storage-warning"
        className="storage-warning"
        hidden={!view?.storageError}
      >
        현재 브라우저에서 자동저장이 차단되었습니다. 풀이 후 “저장 · 백업 → 진행
        포함 HTML 저장”으로 진도를 보관하세요.
      </div>
      <div
        id="account-warning"
        className="account-warning"
        hidden={!view?.warning}
      >
        <span id="account-warning-text">{view?.warning}</span>
        <br />
        <button
          id="load-account-progress"
          type="button"
          hidden={!view?.conflict}
          onClick={async () => {
            if (
              !confirm(
                "현재 기기의 저장 대기 기록 대신 서버의 진도를 불러올까요? 현재 기록이 필요하면 먼저 백업하세요.",
              )
            )
              return;
            try {
              await actions.useRemote();
            } catch {
              notify("서버 기록을 불러오지 못했습니다. 연결을 확인해 주세요.");
            }
          }}
        >
          서버 기록 불러오기
        </button>
      </div>
      <div className="layout">
        <ProgressSidebar
          view={view}
          actions={actions}
          expanded={expanded}
          setExpanded={setExpanded}
          go={go}
        />
        <main id="main" ref={main}>
          <div className="crumb">
            <span className="exam-tag">PRACTICE / 684</span>
            <span id="position">
              {view?.q
                ? `${view.index + 1} / ${view.ids.length} · PDF ${view.q.page}쪽`
                : view
                  ? "조건에 맞는 문제 없음"
                  : ""}
            </span>
          </div>
          <div id="question-mount">
            {view && !view.loading && (
              <QuestionCard
                key={view.q?.id || "empty"}
                view={view}
                images={bank.images}
                actions={actions}
              />
            )}
          </div>
          <div className="nextbar">
            <button
              id="prev"
              disabled={!view || view.index <= 0}
              onClick={() => navigate(-1)}
            >
              ← 이전 문제
            </button>
            <button
              id="next"
              className="primary"
              disabled={
                !view || view.index < 0 || view.index >= view.ids.length - 1
              }
              onClick={() => navigate(1)}
            >
              다음 문제 →
            </button>
          </div>
          <p className="footnote">
            문제·선택지: 제공 PDF · 원문 답안·해설: 제공 TXT
            <br />
            ChatGPT 보충·정정은 원문과 구분해 표시합니다. 검토가 필요한 답안은
            자동채점에서 제외합니다.
          </p>
        </main>
      </div>
      <BackupDialog
        dialog={dialog}
        view={
          view && offline
            ? {
                ...view,
                accountInfo: "이 파일의 기록은 현재 브라우저에 저장됩니다.",
              }
            : view
        }
        actions={actions}
        notify={notify}
      />
      <div id="toast" className="toast" role="status" hidden={!toast}>
        {toast}
      </div>
      <div
        id="loading"
        className="ready-overlay"
        hidden={view && !view.loading}
      >
        <div id="loading-message">
          {view?.loadError || "저장된 진도를 불러오는 중…"}
          {view?.loadError && (
            <>
              <br />
              <button onClick={() => location.reload()}>다시 시도</button>
            </>
          )}
        </div>
      </div>
      <noscript>
        <p>문제를 풀려면 브라우저에서 JavaScript를 허용해 주세요.</p>
      </noscript>
    </div>
  );
}
