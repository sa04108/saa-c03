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
  const brand = (
    <div className="brand">
      <a
        className={wiki ? "brand-home" : "brand-mark"}
        href={wiki ? "/concepts/" : "/"}
        aria-label="SAA-C03 학습 홈"
      >
        {wiki ? (
          <span className="mark" aria-hidden="true">
            S
          </span>
        ) : (
          "S"
        )}
      </a>
      <div className="brand-copy">
        <div className="brand-title-line">
          {wiki ? (
            <a className="brand-title" href="/concepts/">
              <strong>
                SAA-C03 <span>{title}</span>
              </strong>
            </a>
          ) : (
            <h1>
              SAA-C03 <span style={{ fontWeight: 400 }}>{title}</span>
            </h1>
          )}
          <a
            className={`${wiki ? "study-link" : "wiki-link"} page-switch`}
            href={wiki ? "/dumps/" : "/concepts/"}
          >
            {wiki ? "문제집" : "개념 위키"} ↗
          </a>
        </div>
        {wiki ? (
          <small>AWS Certified Solutions Architect · Associate</small>
        ) : (
          <p>AWS Certified Solutions Architect · Associate</p>
        )}
      </div>
    </div>
  );
  return wiki ? (
    <header className="site-header">
      <div className="header-inner">
        {brand}
        <nav className="primary-nav" aria-label="주 메뉴">
          <a className={!quiz ? "active" : ""} href="/concepts/">
            개념 위키
          </a>
          <a className={quiz ? "active" : ""} href="/concepts/quiz/q001/">
            문제 풀이
          </a>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  ) : (
    <header className="top">
      {brand}
      <div className="row top-actions">
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
        <ThemeToggle />
      </div>
      {!offline && <AccountControls compact />}
    </header>
  );
}
