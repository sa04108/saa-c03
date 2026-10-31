"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getAccount } from "@/lib/backend/account";

const AccountContext = createContext(null);
export function AccountProvider({ children, offline = false }) {
  const [state, setState] = useState({
    user: null,
    configured: false,
    initialized: false,
    error: null,
    message: "",
  });
  const [service, setService] = useState(null);
  useEffect(() => {
    if (offline) {
      setState((s) => ({ ...s, initialized: true }));
      return;
    }
    const account = getAccount();
    let active = true;
    setService(account);
    const unsubscribe = account.subscribe((snapshot) => {
      if (active) setState(snapshot);
    });
    account.ready.then(() => {
      if (active) setState(account.snapshot());
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [offline]);
  return (
    <AccountContext.Provider value={{ ...state, service, offline }}>
      {children}
    </AccountContext.Provider>
  );
}
export const useAccount = () => useContext(AccountContext);
export function AccountControls({ compact = false }) {
  const { user, service, initialized, configured, error, message } =
    useAccount();
  const [busy, setBusy] = useState(false),
    [summary, setSummary] = useState("");
  const name =
    user?.user_metadata?.user_name ||
    user?.user_metadata?.preferred_username ||
    "GitHub 사용자";
  useEffect(() => {
    if (compact || !user || !service) return;
    let active = true;
    service
      .summary()
      .then((count) => {
        if (active) setSummary(`계정에 저장된 풀이: ${count} / 684문제`);
      })
      .catch(() => {
        if (active)
          setSummary(
            "계정 진도를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.",
          );
      });
    return () => {
      active = false;
    };
  }, [user, service, compact]);
  const login = async () => {
    setBusy(true);
    try {
      await service?.signIn();
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    setBusy(true);
    try {
      await service?.signOut();
    } finally {
      setBusy(false);
    }
  };
  const note =
    message ||
    (!initialized
      ? "계정 연결을 확인하는 중…"
      : error
        ? "로그인 연결을 확인하지 못했습니다. 새로고침해 주세요."
        : !configured
          ? "계정 연동을 준비 중입니다."
          : "");
  const icon = (
    <img
      className="github-icon"
      src="/assets/github.svg"
      width={compact ? 24 : 32}
      height={compact ? 24 : 32}
      alt={compact ? "" : "GitHub"}
      aria-hidden={compact || undefined}
    />
  );
  if (compact)
    return (
      <div className="account-controls" data-account-ui>
        <button
          className="account-icon-button"
          type="button"
          data-github-login
          aria-label="GitHub 계정 연동"
          title="GitHub 계정 연동"
          disabled={!initialized || !configured || !!error || busy}
          hidden={!!user}
          onClick={login}
        >
          {icon}
        </button>
        <a
          className="account-icon-button"
          href="/#social-accounts"
          data-account-manage
          aria-label={`GitHub 계정 관리: ${name}`}
          title={`GitHub 계정 관리: ${name}`}
          hidden={!user}
        >
          {icon}
          <span className="account-connected-dot" aria-hidden="true" />
        </a>
      </div>
    );
  return (
    <section
      id="social-accounts"
      className="account-section"
      data-account-ui
      aria-labelledby="social-accounts-title"
    >
      <h2 id="social-accounts-title" className="account-heading">
        소셜 계정
      </h2>
      <div className="social-account-row">
        {icon}
        <span className="account-name" data-account-name hidden={!user}>
          {name}
        </span>
        <button
          className="account-button"
          type="button"
          data-github-login
          aria-label="GitHub 계정 연동"
          disabled={!initialized || !configured || !!error || busy}
          hidden={!!user}
          onClick={login}
        >
          계정 연동
        </button>
        <button
          className="account-button account-button-secondary"
          type="button"
          data-account-logout
          aria-label="GitHub 계정 로그아웃"
          hidden={!user}
          disabled={busy}
          onClick={logout}
        >
          로그아웃
        </button>
      </div>
      <p
        className="account-message"
        data-account-message
        role="status"
        aria-live="polite"
        hidden={!note}
      >
        {note}
      </p>
      <p
        className="account-message"
        data-account-progress
        hidden={!user || !summary}
      >
        {summary}
      </p>
    </section>
  );
}
