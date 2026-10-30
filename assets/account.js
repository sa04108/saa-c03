(() => {
  'use strict';
  const scriptUrl = document.currentScript.src;
  const home = new URL('../', scriptUrl).href;
  const config = window.SAA_ACCOUNT_CONFIG || {};
  const bankId = 'saa-c03-684-20260926-v1';
  const configured = /^https:\/\//.test(config.supabaseUrl || '') && !!config.supabasePublishableKey;
  const stores = new Set();
  let client, user = null, initialized = false, error = null;
  let message = '';
  const memory = new Map();
  const storage = {
    getItem(key) { try { return localStorage.getItem(key); } catch { return memory.get(key) || null; } },
    setItem(key, value) { try { localStorage.setItem(key, value); } catch { memory.set(key, value); } },
    removeItem(key) { try { localStorage.removeItem(key); } catch { memory.delete(key); } },
  };

  async function timedFetch(input, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(abort, 12000);
    try { return await fetch(input, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }

  function paint() {
    for (const panel of document.querySelectorAll('[data-account-ui]')) {
      const login = panel.querySelector('[data-github-login]');
      const logout = panel.querySelector('[data-account-logout]');
      const name = panel.querySelector('[data-account-name]');
      const note = panel.querySelector('[data-account-message]');
      const manage = panel.querySelector('[data-account-manage]');
      if (login) { login.hidden = !!user; login.disabled = !configured || !!error; }
      if (logout) logout.hidden = !user;
      if (name) {
        name.hidden = !user;
        name.textContent = user ? (user.user_metadata?.user_name || user.user_metadata?.preferred_username || 'GitHub 사용자') : '';
      }
      if (manage) {
        manage.hidden = !user;
        const label = user ? `GitHub 계정 관리: ${user.user_metadata?.user_name || user.user_metadata?.preferred_username || 'GitHub 사용자'}` : 'GitHub 계정 관리';
        manage.setAttribute('aria-label', label);
        manage.title = label;
      }
      if (login?.classList.contains('account-icon-button')) {
        login.title = error ? 'GitHub 연결을 확인해 주세요' : !configured ? 'GitHub 계정 연동 준비 중' : 'GitHub 계정 연동';
      }
      if (note) {
        note.textContent = message || (error ? '로그인 연결을 확인하지 못했습니다. 새로고침해 주세요.'
          : !configured ? '계정 연동을 준비 중입니다.' : '');
        note.hidden = !note.textContent;
      }
    }
  }

  function cacheFor(id, bank) {
    const key = `saa-c03:cloud:${id}:${bank}`;
    const db = new Promise(resolve => {
      let done = false;
      const finish = result => { if (!done) { done = true; resolve(result); } };
      const timer = setTimeout(() => finish(null), 1500);
      try {
        const request = indexedDB.open('saa-c03-account-cache', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('progress');
        request.onerror = request.onblocked = () => { clearTimeout(timer); finish(null); };
        request.onsuccess = () => {
          clearTimeout(timer);
          if (done) return request.result.close();
          request.result.onversionchange = () => request.result.close();
          finish(request.result);
        };
      } catch { clearTimeout(timer); finish(null); }
    });
    async function database(write, entry) {
      const connection = await db;
      if (!connection) return null;
      return new Promise(resolve => {
        try {
          const transaction = connection.transaction('progress', write ? 'readwrite' : 'readonly');
          const request = write ? transaction.objectStore('progress').put(entry, key) : transaction.objectStore('progress').get(key);
          let value;
          request.onsuccess = () => { value = request.result; };
          transaction.oncomplete = () => resolve(write ? true : value || null);
          transaction.onerror = transaction.onabort = () => resolve(null);
        } catch { resolve(null); }
      });
    }
    return {
      async read() {
        try {
          const raw = localStorage.getItem(key);
          if (raw) return JSON.parse(raw);
        } catch { /* IndexedDB is the fallback. */ }
        return database(false);
      },
      async write(entry) {
        let local = false;
        try { localStorage.setItem(key, JSON.stringify(entry)); local = true; } catch { /* Try IndexedDB. */ }
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
    if (!navigator.locks) throw Error('This browser does not support account storage locks');
    const acquired = await new Promise((resolve, reject) => {
      navigator.locks.request(`saa-c03-progress:${id}:${bank}`, { ifAvailable: true }, lock => {
        if (!lock) { resolve(false); return; }
        resolve(true);
        return new Promise(unlock => { release = unlock; });
      }).catch(reject);
    });
    if (!acquired) throw Error('Account progress is already open in another tab');
    const { ProgressStore } = await import(new URL('progress-store.mjs', scriptUrl));
    const api = {
      async load() {
        const result = await client.from('study_progress').select('revision,state')
          .eq('user_id', id).eq('bank_id', bank).maybeSingle();
        if (result.error) throw result.error;
        return result.data || { revision: 0, state: null };
      },
      async save(revision, state) {
        const result = await client.rpc('save_study_progress', {
          p_user_id: id, p_bank_id: bank, p_expected_revision: revision, p_state: state,
        });
        if (result.error) throw result.error;
        return result.data;
      },
    };
    const store = new ProgressStore({ api, cache: cacheFor(id, bank), empty, validate, onStatus, onRemote });
    const dispose = store.dispose.bind(store);
    store.dispose = () => { dispose(); release(); stores.delete(store); };
    stores.add(store);
    return store;
  }

  async function signIn(button) {
    if (!client || user) return;
    try {
      const probe = 'saa-c03-auth-probe';
      localStorage.setItem(probe, '1'); localStorage.removeItem(probe);
    } catch {
      message = 'GitHub 로그인은 브라우저의 사이트 데이터 저장을 허용한 뒤 이용해 주세요.';
      paint(); return;
    }
    button.disabled = true;
    try {
      const result = await client.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: home } });
      if (result.error) throw result.error;
    } catch {
      message = 'GitHub 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      paint();
    }
  }

  async function signOut() {
    const results = await Promise.all([...stores].map(store => store.flush()));
    if (results.some(saved => !saved) && !confirm('서버에 저장되지 않은 기록이 있습니다. 먼저 백업하는 것을 권합니다. 그래도 로그아웃할까요?')) return;
    const result = await client.auth.signOut({ scope: 'local' });
    if (result.error) { message = '로그아웃하지 못했습니다. 다시 시도해 주세요.'; paint(); }
  }

  const ready = (async () => {
    if (!configured) return { configured, user, error };
    try {
      client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, storageKey: 'saa-c03-github-auth', storage },
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
    } catch { error = 'auth-unavailable'; }
    return { configured, user, error };
  })();
  window.SaaAccount = { ready, createStore, get user() { return user; } };

  document.addEventListener('click', event => {
    const login = event.target.closest('[data-github-login]');
    if (login) void signIn(login);
    if (event.target.closest('[data-account-logout]')) void signOut();
  });
  window.addEventListener('online', () => { for (const store of stores) void store.refresh(); });
  window.addEventListener('focus', () => { for (const store of stores) void store.refresh(); });
  document.addEventListener('visibilitychange', () => {
    for (const store of stores) void (document.hidden ? store.flush() : store.refresh());
  });
  window.addEventListener('pagehide', () => {
    for (const store of stores) { void store.flush(); store.dispose(); }
  });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  const mount = async () => {
    await ready; paint();
    if (document.body.dataset.page !== 'home' || !user) return;
    const summary = document.querySelector('[data-account-progress]');
    const empty = () => ({ version: 1, bank: bankId, updatedAt: 0, current: 1, filter: 'all', query: '', records: {} });
    const validate = state => {
      if (!state || state.bank !== bankId || state.version !== 1 || !state.records || typeof state.records !== 'object') throw Error('Invalid progress');
      return state;
    };
    try {
      function show(state) {
        summary.hidden = false;
        summary.textContent = `계정에 저장된 풀이: ${Object.values(state.records).filter(record => record.checked).length} / 684문제`;
      }
      const result = await client.from('study_progress').select('state')
        .eq('user_id', user.id).eq('bank_id', bankId).maybeSingle();
      if (result.error) throw result.error;
      show(validate(result.data?.state || empty()));
    } catch { summary.hidden = false; summary.textContent = '계정 진도를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.'; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void mount(); }, { once: true });
  else void mount();
})();
