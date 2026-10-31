import { createClient } from "@supabase/supabase-js";
import { backendConfig as config } from "./config";
import { ProgressStore } from "../study/progress-store";

let account;
export function getAccount() {
  return (account ||= createAccount());
}
function createAccount() {
  "use strict";
  const home = new URL("/", location.href).href;
  const bankId = "saa-c03-684-20260926-v1";
  const configured =
    /^https:\/\//.test(config.supabaseUrl || "") &&
    !!config.supabasePublishableKey;
  const stores = new Set();
  let client,
    user = null,
    initialized = false,
    error = null;
  let message = "";
  const memory = new Map();
  const storage = {
    getItem(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return memory.get(key) || null;
      }
    },
    setItem(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        memory.set(key, value);
      }
    },
    removeItem(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        memory.delete(key);
      }
    },
  };

  async function timedFetch(input, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(abort, 12000);
    try {
      return await fetch(input, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }

  const listeners = new Set();
  const snapshot = () => ({ configured, user, error, message, initialized });
  function paint() {
    for (const listener of listeners) listener(snapshot());
  }

  function cacheFor(id, bank) {
    const key = `saa-c03:cloud:${id}:${bank}`;
    const db = new Promise((resolve) => {
      let done = false;
      const finish = (result) => {
        if (!done) {
          done = true;
          resolve(result);
        }
      };
      const timer = setTimeout(() => finish(null), 1500);
      try {
        const request = indexedDB.open("saa-c03-account-cache", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("progress");
        request.onerror = request.onblocked = () => {
          clearTimeout(timer);
          finish(null);
        };
        request.onsuccess = () => {
          clearTimeout(timer);
          if (done) return request.result.close();
          request.result.onversionchange = () => request.result.close();
          finish(request.result);
        };
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    });
    async function database(write, entry) {
      const connection = await db;
      if (!connection) return null;
      return new Promise((resolve) => {
        try {
          const transaction = connection.transaction(
            "progress",
            write ? "readwrite" : "readonly",
          );
          const request = write
            ? transaction.objectStore("progress").put(entry, key)
            : transaction.objectStore("progress").get(key);
          let value;
          request.onsuccess = () => {
            value = request.result;
          };
          transaction.oncomplete = () => resolve(write ? true : value || null);
          transaction.onerror = transaction.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return {
      async read() {
        try {
          const raw = localStorage.getItem(key);
          if (raw) return JSON.parse(raw);
        } catch {
          /* IndexedDB is the fallback. */
        }
        return database(false);
      },
      async write(entry) {
        let local = false;
        try {
          localStorage.setItem(key, JSON.stringify(entry));
          local = true;
        } catch {
          /* Try IndexedDB. */
        }
        return !!(await database(true, entry)) || local;
      },
    };
  }

  async function createStore({ bank, empty, validate, onStatus, onRemote }) {
    await ready;
    if (!user) return null;
    const id = user.id; // Never take the account ID from editable progress JSON.
    // One editing tab per browser avoids overwriting its durable pending cache.
    // Other devices still use independent caches and server revision checks.
    let release;
    if (!navigator.locks)
      throw Error("This browser does not support account storage locks");
    const acquired = await new Promise((resolve, reject) => {
      navigator.locks
        .request(
          `saa-c03-progress:${id}:${bank}`,
          { ifAvailable: true },
          (lock) => {
            if (!lock) {
              resolve(false);
              return;
            }
            resolve(true);
            return new Promise((unlock) => {
              release = unlock;
            });
          },
        )
        .catch(reject);
    });
    if (!acquired)
      throw Error("Account progress is already open in another tab");
    const api = {
      async load() {
        const result = await client
          .from("study_progress")
          .select("revision,state")
          .eq("user_id", id)
          .eq("bank_id", bank)
          .maybeSingle();
        if (result.error) throw result.error;
        return result.data || { revision: 0, state: null };
      },
      async save(revision, state) {
        const result = await client.rpc("save_study_progress", {
          p_user_id: id,
          p_bank_id: bank,
          p_expected_revision: revision,
          p_state: state,
        });
        if (result.error) throw result.error;
        return result.data;
      },
    };
    const store = new ProgressStore({
      api,
      cache: cacheFor(id, bank),
      empty,
      validate,
      onStatus,
      onRemote,
    });
    const dispose = store.dispose.bind(store);
    store.dispose = () => {
      dispose();
      release();
      stores.delete(store);
    };
    stores.add(store);
    return store;
  }

  async function signIn() {
    if (!client || user) return;
    try {
      const probe = "saa-c03-auth-probe";
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
    } catch {
      message =
        "GitHub 로그인은 브라우저의 사이트 데이터 저장을 허용한 뒤 이용해 주세요.";
      paint();
      return;
    }
    try {
      const result = await client.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: home },
      });
      if (result.error) throw result.error;
    } catch {
      message =
        "GitHub 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      paint();
    }
  }

  async function signOut() {
    const results = await Promise.all(
      [...stores].map((store) => store.flush()),
    );
    if (
      results.some((saved) => !saved) &&
      !confirm(
        "서버에 저장되지 않은 기록이 있습니다. 먼저 백업하는 것을 권합니다. 그래도 로그아웃할까요?",
      )
    )
      return;
    const result = await client.auth.signOut({ scope: "local" });
    if (result.error) {
      message = "로그아웃하지 못했습니다. 다시 시도해 주세요.";
      paint();
    }
  }

  const ready = (async () => {
    if (!configured) return { configured, user, error };
    try {
      client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: {
          flowType: "pkce",
          detectSessionInUrl: true,
          persistSession: true,
          storageKey: "saa-c03-github-auth",
          storage,
        },
        global: { fetch: timedFetch },
      });
      client.auth.onAuthStateChange((_event, session) => {
        if (initialized && (session?.user?.id || null) !== (user?.id || null)) {
          for (const store of stores) store.dispose();
          document.documentElement.inert = true;
          location.reload();
        }
      });
      const result = await client.auth.getSession();
      if (result.error) throw result.error;
      user = result.data.session?.user || null;
      initialized = true;
    } catch {
      error = "auth-unavailable";
      initialized = true;
    }
    return { configured, user, error };
  })();
  async function getAccessToken() {
    await ready;
    if (!client || !user) return null;
    let result = await client.auth.getSession();
    if (
      result.data.session &&
      result.data.session.expires_at * 1000 < Date.now() + 60000
    ) {
      result = await client.auth.refreshSession();
    }
    if (
      result.error ||
      !result.data.session ||
      result.data.session.user.id !== user.id
    )
      throw Error("auth_unavailable");
    return result.data.session.access_token;
  }
  window.addEventListener("online", () => {
    for (const store of stores) void store.refresh();
  });
  window.addEventListener("focus", () => {
    for (const store of stores) void store.refresh();
  });
  document.addEventListener("visibilitychange", () => {
    for (const store of stores)
      void (document.hidden ? store.flush() : store.refresh());
  });
  window.addEventListener("pagehide", () => {
    for (const store of stores) {
      void store.flush();
      store.dispose();
    }
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
  async function summary() {
    await ready;
    if (!user) return null;
    const result = await client
      .from("study_progress")
      .select("state")
      .eq("user_id", user.id)
      .eq("bank_id", bankId)
      .maybeSingle();
    if (result.error) throw result.error;
    return Object.values(result.data?.state?.records || {}).filter(
      (record) => record.checked,
    ).length;
  }
  return {
    ready,
    createStore,
    getAccessToken,
    signIn,
    signOut,
    summary,
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get user() {
      return user;
    },
  };
}
