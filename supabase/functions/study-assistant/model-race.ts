export class ModelsUnavailable extends Error {
  constructor() { super('models_unavailable'); }
}

export type ModelAttempt = {
  model: string;
  startedAt: string;
  signal: AbortSignal;
  sharedSignal: AbortSignal;
  remainingMs: () => number;
  text: (text: string) => void;
  reset: () => void;
};

export const MODEL_START_INTERVAL_MS = 5000;

// Five seconds starts another request; latency alone never records a failure.
// Every attempt gets its own deadline. The first visible answer owns the stream.
export async function raceModels<T>(options: {
  models: readonly string[];
  modelTimeoutMs: number;
  signal: AbortSignal;
  run: (attempt: ModelAttempt) => Promise<T>;
  classify: (error: unknown) => string | null;
  onFailure: (attempt: ModelAttempt, reason: string) => void;
  onDelay?: (attempt: ModelAttempt) => void;
  emit?: (event: string, data: unknown) => void;
}): Promise<{ value: T; attempt: ModelAttempt }> {
  options.signal.throwIfAborted();
  if (!options.models.length) throw new ModelsUnavailable();
  if (!Number.isFinite(options.modelTimeoutMs) || options.modelTimeoutMs <= 0) throw new RangeError('Invalid model timeout');
  const lifetime = new AbortController();
  const sharedSignal = AbortSignal.any([options.signal, lifetime.signal]);
  const launchTimers = new Set<ReturnType<typeof setTimeout>>();
  const attempts: Array<{ attempt: ModelAttempt; cancel: () => void }> = [];
  let selected: ModelAttempt | undefined, finished = false, launched = 0, pending = 0;
  let resolve: (value: { value: T; attempt: ModelAttempt }) => void;
  let reject: (reason: unknown) => void;
  const result = new Promise<{ value: T; attempt: ModelAttempt }>((yes, no) => { resolve = yes; reject = no; });
  const stop = (error: unknown) => {
    if (!finished) { finished = true; reject(error); }
  };
  const abort = () => stop(options.signal.reason);
  options.signal.addEventListener('abort', abort, { once: true });

  function launch(model: string) {
    if (finished || selected || sharedSignal.aborted) return;
    launched++; pending++;
    const deadlineAt = performance.now() + options.modelTimeoutMs;
    const controller = new AbortController();
    let settled = false, failed = false, prefix = '';
    let deadlineTimer: ReturnType<typeof setTimeout>, delayTimer: ReturnType<typeof setTimeout>;
    const settle = () => {
      if (settled) return;
      settled = true; pending--;
      clearTimeout(deadlineTimer); clearTimeout(delayTimer);
      if (!finished && launched === options.models.length && !pending) stop(new ModelsUnavailable());
    };
    const fail = (reason: string) => {
      if (failed) return;
      failed = true;
      options.onFailure(attempt, reason);
    };
    const expire = () => {
      if (settled || finished || attempt.signal.aborted) return;
      fail('timeout');
      controller.abort(new DOMException('Model response timeout', 'TimeoutError'));
      if (selected === attempt) stop(new ModelsUnavailable());
      settle();
    };
    const choose = () => {
      attempt.signal.throwIfAborted();
      if (finished || settled) return false;
      // Enforce the deadline even if a busy event loop delivers its timer late.
      if (performance.now() >= deadlineAt) { expire(); return false; }
      if (selected && selected !== attempt) return false;
      if (!selected) {
        selected = attempt;
        clearTimeout(delayTimer);
        for (const timer of launchTimers) clearTimeout(timer);
        for (const other of attempts) if (other.attempt !== attempt) other.cancel();
      }
      return true;
    };
    const attempt: ModelAttempt = {
      model, startedAt: new Date().toISOString(),
      signal: AbortSignal.any([sharedSignal, controller.signal]), sharedSignal,
      remainingMs: () => Math.max(0, deadlineAt - performance.now()),
      text: text => {
        if (!text) return;
        prefix += text;
        if (!prefix.trim()) return;
        if (choose()) { options.emit?.('delta', { text: prefix }); prefix = ''; }
      },
      reset: () => { if (selected === attempt && !finished) options.emit?.('reset', {}); },
    };
    delayTimer = setTimeout(() => {
      if (!settled && !finished && !selected && !attempt.signal.aborted) options.onDelay?.(attempt);
    }, MODEL_START_INTERVAL_MS);
    deadlineTimer = setTimeout(expire, options.modelTimeoutMs);
    attempts.push({ attempt, cancel: () => {
      controller.abort(new DOMException('Model request no longer needed', 'AbortError'));
      settle();
    } });
    // Attach both handlers immediately; aborted losers cannot overwrite a winner.
    void options.run(attempt).then(value => {
      if (attempt.signal.aborted || finished) return;
      if (choose()) { finished = true; resolve({ value, attempt }); }
    }, error => {
      if (attempt.signal.aborted || finished) return;
      if (performance.now() >= deadlineAt) { expire(); return; }
      const reason = options.classify(error);
      if (reason === null) { stop(error); return; }
      fail(reason);
      if (selected === attempt) stop(new ModelsUnavailable());
    }).finally(settle);
  }

  try {
    launch(options.models[0]);
    for (let i = 1; i < options.models.length; i++) {
      launchTimers.add(setTimeout(() => launch(options.models[i]), i * MODEL_START_INTERVAL_MS));
    }
    return await result;
  } finally {
    finished = true;
    for (const timer of launchTimers) clearTimeout(timer);
    options.signal.removeEventListener('abort', abort);
    lifetime.abort(new DOMException('Model request finished', 'AbortError'));
    for (const other of attempts) other.cancel();
  }
}
