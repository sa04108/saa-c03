const clone = (value) => JSON.parse(JSON.stringify(value));
const BANK_ID = "saa-c03-684-20260926-v1";
export const emptyProgress = () => ({
  version: 1,
  bank: BANK_ID,
  updatedAt: 0,
  current: 1,
  filter: "all",
  query: "",
  records: {},
});
let previousDisposal = Promise.resolve();

export function createStudySession({
  bank,
  notes,
  account,
  embedded,
  onChange,
  notify,
}) {
  const questions = bank.questions,
    byId = new Map(questions.map((q) => [q.id, q]));
  const answerFor = (q) => notes[q.id]?.answerOverride || q.answer;
  const hasAnswer = (q) =>
    !notes[q.id]?.answerReview && answerFor(q).length > 0;
  const guestKey = BANK_ID + ":progress";
  let key = guestKey,
    databaseName = BANK_ID,
    db = null,
    cloudStore = null,
    guestProgress = null;
  let state = emptyProgress(),
    loading = true,
    stopped = false,
    mapPage = 0,
    frozenIDs = null,
    searchTimer;
  let status = "저장 상태 확인 중",
    warning = "",
    conflict = false,
    storageError = false,
    loadError = "";
  let accountInfo =
    "이 브라우저에만 저장됩니다. GitHub로 로그인하면 계정에 진도를 저장할 수 있습니다.";
  const lifetime = new AbortController();
  function validate(value) {
    if (
      !value ||
      value.version !== 1 ||
      value.bank !== BANK_ID ||
      !value.records ||
      typeof value.records !== "object" ||
      Array.isArray(value.records)
    )
      throw Error("Invalid bank");
    if (
      !Number.isInteger(value.current) ||
      !byId.has(value.current) ||
      !Number.isFinite(value.updatedAt) ||
      value.updatedAt < 0
    )
      throw Error("Invalid state");
    const result = {
      ...emptyProgress(),
      updatedAt: value.updatedAt,
      current: value.current,
      filter: ["all", "unanswered", "wrong", "flagged", "missing"].includes(
        value.filter,
      )
        ? value.filter
        : "all",
      query: typeof value.query === "string" ? value.query.slice(0, 200) : "",
      records: {},
    };
    for (const [id, r] of Object.entries(value.records)) {
      const q = byId.get(Number(id));
      if (
        !q ||
        String(q.id) !== id ||
        !r ||
        !Array.isArray(r.selected) ||
        r.selected.length > q.count ||
        new Set(r.selected).size !== r.selected.length ||
        r.selected.some((a) => !q.options.some((o) => o.key === a)) ||
        typeof r.checked !== "boolean" ||
        typeof r.flagged !== "boolean" ||
        !Number.isFinite(r.updatedAt) ||
        r.updatedAt < 0 ||
        (r.checked && hasAnswer(q) && r.selected.length !== q.count)
      )
        throw Error("Invalid record");
      result.records[id] = {
        selected: [...r.selected].sort(),
        checked: r.checked,
        flagged: r.flagged,
        updatedAt: r.updatedAt,
      };
    }
    return result;
  }
  function readSafe(raw) {
    try {
      return raw
        ? validate(typeof raw === "string" ? JSON.parse(raw) : raw)
        : null;
    } catch {
      return null;
    }
  }
  function record(q) {
    return (
      state.records[q.id] || {
        selected: [],
        checked: false,
        flagged: false,
        updatedAt: 0,
      }
    );
  }
  function result(q) {
    const r = record(q);
    return !r.checked
      ? r.selected.length
        ? "draft"
        : "unanswered"
      : !hasAnswer(q)
        ? "viewed"
        : r.selected.join("") === answerFor(q).join("")
          ? "correct"
          : "wrong";
  }
  function shownIDs() {
    return questions
      .filter((q) => {
        const r = record(q),
          s = result(q);
        return (
          (state.filter === "all" ||
            (state.filter === "unanswered" && !r.checked) ||
            (state.filter === "wrong" && s === "wrong") ||
            (state.filter === "flagged" && r.flagged) ||
            (state.filter === "missing" && !hasAnswer(q))) &&
          (!state.query ||
            (q.stem + " " + q.options.map((o) => o.text).join(" "))
              .toLowerCase()
              .includes(state.query.toLowerCase()))
        );
      })
      .map((q) => q.id);
  }
  const ids = () => frozenIDs || shownIDs();
  function freshFilter() {
    frozenIDs = shownIDs();
    if (!frozenIDs.includes(state.current) && frozenIDs.length)
      state.current = frozenIDs[0];
    mapPage = Math.max(0, Math.floor(frozenIDs.indexOf(state.current) / 40));
  }
  function snapshot() {
    const visible = ids(),
      pages = Math.max(1, Math.ceil(visible.length / 40));
    mapPage = Math.max(0, Math.min(mapPage, pages - 1));
    const graded = questions.filter((q) =>
      ["correct", "wrong"].includes(result(q)),
    );
    const correct = graded.filter((q) => result(q) === "correct").length;
    const reviewed = questions.filter((q) => record(q).checked).length;
    const q = visible.length ? byId.get(state.current) : null;
    return {
      state: { ...state },
      loading,
      loadError,
      status,
      warning,
      conflict,
      storageError,
      accountInfo,
      hasGuest:
        !!cloudStore && !!Object.keys(guestProgress?.records || {}).length,
      q,
      record: q ? record(q) : null,
      note: q ? notes[q.id] || {} : {},
      result: q ? result(q) : "",
      answer: q ? answerFor(q) : [],
      gradable: q ? hasAnswer(q) : false,
      reviewed,
      correct,
      wrong: graded.length - correct,
      remaining: questions.length - reviewed,
      ids: visible,
      index: visible.indexOf(state.current),
      mapPage,
      pages,
      map: visible
        .slice(mapPage * 40, (mapPage + 1) * 40)
        .map((id) => ({
          id,
          result: result(byId.get(id)),
          flagged: record(byId.get(id)).flagged,
        })),
      missing: questions.filter((q) => !hasAnswer(q)).map((q) => q.id),
      imageCount: Object.keys(bank.images).length,
    };
  }
  function publish() {
    if (!stopped) onChange(snapshot());
  }
  function saveDisplay(mode) {
    status =
      mode === "saving"
        ? "저장 중…"
        : mode === "ok"
          ? "자동저장 완료"
          : "저장 불가 · 백업 필요";
    storageError = mode === "error";
    publish();
  }
  function merge(a, b) {
    if (!b) return a;
    const out = {
      ...(b.updatedAt > a.updatedAt ? b : a),
      records: { ...a.records },
    };
    for (const [id, r] of Object.entries(b.records))
      if (!out.records[id] || r.updatedAt > out.records[id].updatedAt)
        out.records[id] = r;
    return out;
  }
  function writeLocal(serialized) {
    try {
      const old = localStorage.getItem(key);
      if (old && readSafe(old))
        try {
          localStorage.setItem(key + ":previous", old);
        } catch {}
      localStorage.setItem(key, serialized);
      return localStorage.getItem(key) === serialized;
    } catch {
      return false;
    }
  }
  function dbPut(value) {
    return new Promise((resolve) => {
      if (!db) return resolve(false);
      try {
        const t = db.transaction("progress", "readwrite");
        t.objectStore("progress").put(value, "current");
        t.oncomplete = () => resolve(true);
        t.onerror = t.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }
  function dbRead() {
    return new Promise((resolve) => {
      if (!db) return resolve(null);
      try {
        const req = db
          .transaction("progress", "readonly")
          .objectStore("progress")
          .get("current");
        req.onsuccess = () => resolve(readSafe(req.result));
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  function openDB() {
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (!done) {
          done = true;
          resolve(value);
        }
      };
      const timer = setTimeout(() => finish(null), 1800);
      try {
        const req = indexedDB.open(databaseName, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains("progress"))
            req.result.createObjectStore("progress");
        };
        req.onsuccess = () => {
          clearTimeout(timer);
          if (done || stopped) {
            req.result.close();
            finish(null);
            return;
          }
          req.result.onversionchange = () => req.result.close();
          finish(req.result);
        };
        req.onerror = req.onblocked = () => {
          clearTimeout(timer);
          finish(null);
        };
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    });
  }
  function persist(sendToAccount = true) {
    if (loading || stopped) return;
    state.updatedAt = Math.max(Date.now(), state.updatedAt + 1);
    if (!cloudStore)
      try {
        state = merge(state, readSafe(localStorage.getItem(key)));
      } catch {}
    const sent = clone(state),
      localOK = writeLocal(JSON.stringify(sent));
    if (!cloudStore) saveDisplay(localOK ? "ok" : "saving");
    dbPut(sent).then((ok) => {
      if (!cloudStore && !stopped && sent.updatedAt === state.updatedAt)
        saveDisplay(localOK || ok ? "ok" : "error");
    });
    if (cloudStore && sendToAccount) cloudStore.update(sent);
  }
  function accountStatus(mode, info) {
    if (stopped) return;
    status =
      {
        pending: "계정 저장 대기…",
        syncing: "계정에 저장 중…",
        saved: "계정 저장 완료",
        offline: "연결 끊김 · 저장 대기",
        conflict: "다른 기기의 기록 확인 필요",
      }[mode] || "계정 연결 확인 중";
    conflict = mode === "conflict";
    warning = conflict
      ? "다른 기기에서 기록이 변경되어 덮어쓰지 않았습니다. 현재 기록을 백업한 뒤 서버 기록을 불러오세요."
      : mode === "offline"
        ? info.durable
          ? "이 기기에 보관했습니다. 연결이 복구되면 계정에 다시 저장합니다."
          : "계정에 저장하지 못했고 기기 보관도 사용할 수 없습니다. 페이지를 닫기 전에 백업하세요."
        : "";
    publish();
  }
  function changeRecord(update) {
    const q = byId.get(state.current);
    if (loading || stopped || !q) return;
    const r = clone(record(q));
    update(r);
    r.updatedAt = Math.max(Date.now(), state.updatedAt + 1);
    state.records[q.id] = r;
    persist();
    publish();
  }
  function filter(value, query = state.query) {
    clearTimeout(searchTimer);
    state.filter = value;
    state.query = query;
    freshFilter();
    persist();
    publish();
  }
  function go(id) {
    if (!byId.has(id) || loading) return;
    state.current = id;
    mapPage = Math.max(0, Math.floor(ids().indexOf(id) / 40));
    persist();
    publish();
  }
  function select(value) {
    const q = byId.get(state.current);
    if (!q || record(q).checked || !q.options.some((o) => o.key === value))
      return;
    changeRecord((r) => {
      if (q.count === 1) r.selected = r.selected.includes(value) ? [] : [value];
      else if (r.selected.includes(value))
        r.selected = r.selected.filter((a) => a !== value);
      else if (r.selected.length < q.count) r.selected.push(value);
      else notify(q.count + "개까지만 선택할 수 있습니다.");
      r.selected.sort();
    });
  }
  function replace(value, all = true) {
    const imported = validate(clone(value));
    const stamp = Math.max(
      Date.now(),
      state.updatedAt + 1,
      imported.updatedAt + 1,
    );
    state = imported;
    for (const q of questions) {
      const r = state.records[q.id];
      if (r || all)
        state.records[q.id] = {
          ...(r || { selected: [], checked: false, flagged: false }),
          updatedAt: stamp,
        };
    }
    state.updatedAt = stamp;
    clearTimeout(searchTimer);
    freshFilter();
    persist();
    publish();
  }
  const ready = (async () => {
    await previousDisposal;
    if (stopped) return;
    const auth = account ? await account.ready : { user: null };
    if (stopped) return;
    let local;
    try {
      local =
        readSafe(localStorage.getItem(key)) ||
        readSafe(localStorage.getItem(key + ":previous"));
    } catch {}
    for (const value of [local, readSafe(embedded)])
      if (value) state = merge(state, value);
    db = await openDB();
    const stored = await dbRead();
    if (stored) state = merge(state, stored);
    if (stopped) {
      db?.close();
      return;
    }
    guestProgress = clone(state);
    if (auth.user) {
      db?.close();
      key = guestKey + ":account:" + auth.user.id;
      databaseName = BANK_ID + ":account:" + auth.user.id;
      db = await openDB();
      if (stopped) {
        db?.close();
        return;
      }
      cloudStore = await account.createStore({
        bank: BANK_ID,
        empty: emptyProgress,
        validate,
        onStatus: accountStatus,
        onRemote(value) {
          if (stopped) return;
          state = validate(value);
          freshFilter();
          publish();
          persist(false);
        },
      });
      if (stopped) {
        cloudStore?.dispose();
        return;
      }
      state = await cloudStore.load();
      accountInfo =
        "로그인한 GitHub 계정에 저장합니다. 다른 기기에서도 같은 계정으로 이어서 풀 수 있습니다.";
    }
    if (stopped) {
      cloudStore?.dispose();
      db?.close();
      return;
    }
    freshFilter();
    loading = false;
    publish();
    persist(false);
  })().catch(() => {
    if (stopped) return;
    if (account?.user) {
      loadError =
        "계정 진도를 불러오지 못했습니다. 같은 브라우저의 다른 문제집 탭을 닫고, 연결을 확인한 뒤 새로고침해 주세요.";
      publish();
      return;
    }
    loading = false;
    freshFilter();
    saveDisplay("error");
  });
  window.addEventListener(
    "storage",
    (e) => {
      if (cloudStore || loading || e.key !== key) return;
      const incoming = readSafe(e.newValue);
      if (!incoming) return;
      state = merge(state, incoming);
      freshFilter();
      saveDisplay("ok");
    },
    { signal: lifetime.signal },
  );
  const flushLocal = () => {
    if (loading) return;
    if (!cloudStore)
      try {
        state = merge(state, readSafe(localStorage.getItem(key)));
      } catch {}
    writeLocal(JSON.stringify(state));
  };
  window.addEventListener("pagehide", flushLocal, { signal: lifetime.signal });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) flushLocal();
    },
    { signal: lifetime.signal },
  );
  return {
    snapshot,
    ready,
    select,
    filter,
    go,
    validate,
    navigate(delta) {
      const list = ids(),
        next = list[list.indexOf(state.current) + delta];
      if (next) go(next);
    },
    jump(id) {
      if (!byId.has(id)) return;
      clearTimeout(searchTimer);
      state.filter = "all";
      state.query = "";
      frozenIDs = null;
      go(id);
    },
    search(query) {
      state.query = query.slice(0, 200);
      clearTimeout(searchTimer);
      publish();
      searchTimer = setTimeout(() => filter(state.filter), 300);
    },
    page(delta) {
      mapPage += delta;
      publish();
    },
    flag() {
      changeRecord((r) => {
        r.flagged = !r.flagged;
      });
    },
    check() {
      const q = byId.get(state.current);
      if (q && (!hasAnswer(q) || record(q).selected.length === q.count))
        changeRecord((r) => {
          r.checked = true;
        });
    },
    retry() {
      changeRecord((r) => {
        r.checked = false;
        r.selected = [];
      });
    },
    exportState() {
      return clone(state);
    },
    importState: replace,
    importGuest() {
      if (cloudStore && guestProgress) replace(guestProgress, false);
    },
    reset() {
      replace(emptyProgress());
    },
    async useRemote() {
      if (cloudStore) await cloudStore.useRemote();
    },
    dispose() {
      flushLocal();
      stopped = true;
      clearTimeout(searchTimer);
      lifetime.abort();
      previousDisposal = ready
        .then(async () => {
          if (cloudStore) {
            await cloudStore.flush();
            cloudStore.dispose();
          }
          db?.close();
        })
        .catch(() => {
          cloudStore?.dispose();
          db?.close();
        });
    },
  };
}
