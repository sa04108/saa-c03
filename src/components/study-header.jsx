"use client";
import { ThemeToggle } from "./theme-provider";
import { AccountControls, useAccount } from "./account-provider";

export function StudyHeader({
  page,
  quiz = false,
  status,
  statusError,
  onSettings,
}) {
  const { offline } = useAccount();
  const wiki = page === "concepts";
  const title = wiki ? "개념 위키" : "문제집";
  return (
    <header className="study-header">
      <div className="study-header-inner">
        <div className="study-brand">
          <a
            className="study-brand-home"
            href={wiki ? "/concepts/" : "/"}
            aria-label="SAA-C03 학습 홈"
          >
            <span className="study-mark" aria-hidden="true">S</span>
          </a>
          <div className="study-brand-copy">
            <div className="study-title-line">
              {wiki ? (
                <a className="study-title" href="/concepts/">
                  SAA-C03 <span>{title}</span>
                </a>
              ) : (
                <h1 className="study-title">
                  SAA-C03 <span>{title}</span>
                </h1>
              )}
              <a className="page-switch" href={wiki ? "/dumps/" : "/concepts/"}>
                {wiki ? "문제집" : "개념 위키"} ↗
              </a>
            </div>
            <p className="study-subtitle">
              AWS Certified Solutions Architect · Associate
            </p>
          </div>
        </div>
        <div className="study-header-actions">
          {wiki ? (
            <nav className="study-nav" aria-label="주 메뉴">
              <a
                className={!quiz ? "active" : ""}
                aria-current={!quiz ? "page" : undefined}
                href="/concepts/"
              >
                개념 위키
              </a>
              <a
                className={quiz ? "active" : ""}
                aria-current={quiz ? "page" : undefined}
                href="/concepts/quiz/q001/"
              >
                문제 풀이
              </a>
            </nav>
          ) : (
            <div className="study-save-controls">
              <button id="open-settings" onClick={onSettings}>
                저장 · 백업
              </button>
              <span
                id="save-status"
                className={`save-pill${statusError ? " error" : ""}`}
                role="status"
              >
                {status}
              </span>
            </div>
          )}
          <ThemeToggle />
        </div>
        {!offline && <AccountControls compact />}
      </div>
    </header>
  );
}
