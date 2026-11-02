export class ModelsUnavailable extends Error {
  constructor(public deadline = false) { super('models_unavailable'); }
}

export type ModelAttempt = {
  model: string;
  startedAt: string;
  signal: AbortSignal;
  sharedSignal: AbortSignal;
  penalized: boolean;
  remainingMs: () => number;
  text: (text: string) => void;
  reset: () => void;
};

// Five seconds starts another request; it never cancels the earlier request.
// Only the first model to produce visible text owns the rest of the stream.
export async function raceModels<T>(options: {
  models: readonly string[];
  signal: AbortSignal;
  run: (attempt: ModelAttempt) => Promise<T>;
  classify: (error: unknown) => string | null;
  onFailure: (attempt: ModelAttempt, reason: string) => void;
  emit?: (event: string, data: unknown) => void;
}): Promise<{ value: T; attempt: ModelAttempt }> {
  options.signal.throwIfAborted();
  if (!options.models.length) throw new ModelsUnavailable();
  const lifetime = new AbortController();
  const sharedSignal = AbortSignal.any([options.signal, lifetime.signal]);
  const deadlineAt = performance.now() + 30000;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const attempts: Array<{ attempt: ModelAttempt; controller: AbortController; timer: ReturnType<typeof setTimeout>; checkLate: () => void }> = [];
  let selected: ModelAttempt | undefined, finished = false, launched = 0, pending = 0;
  let resolve: (value: { value: T; attempt: ModelAttempt }) => void;
  let reject: (reason: unknown) => void;
  const result = new Promise<{ value: T; attempt: ModelAttempt }>((yes, no) => { resolve = yes; reject = no; });
  const stop = (error: unknown) => {
    if (!finished) { finished = true; reject(error); }
  };
  const abort = () => stop(options.signal.reason);
  options.signal.addEventListener('abort', abort, { once: true });
  const expire = setTimeout(() => stop(new ModelsUnavailable(true)), 30000);

  function launch(model: string) {
    if (finished || selected || sharedSignal.aborted) return;
    if (performance.now() >= deadlineAt) { stop(new ModelsUnavailable(true)); return; }
    launched++; pending++;
    const started = performance.now(), controller = new AbortController();
    let received = false, settled = false, prefix = '';
    const penalize = (reason: string) => {
      if (attempt.penalized) return;
      attempt.penalized = true;
      options.onFailure(attempt, reason);
    };
    const choose = () => {
      attempt.signal.throwIfAborted();
      if (finished) return false;
      if (performance.now() >= deadlineAt) { stop(new ModelsUnavailable(true)); return false; }
      if (selected && selected !== attempt) return false;
      if (!received) {
        // Account for an event loop that delivered the timer a little late.
        if (performance.now() - started >= 5000) penalize('timeout');
        received = true;
        clearTimeout(timer);
      }
      if (!selected) {
        selected = attempt;
        for (const timer of timers) clearTimeout(timer);
        for (const other of attempts) if (other.attempt !== attempt) {
          other.checkLate();
          clearTimeout(other.timer);
          other.controller.abort(new DOMException('Another model answered first', 'AbortError'));
        }
      }
      return true;
    };
    const attempt: ModelAttempt = {
      model, startedAt: new Date().toISOString(),
      signal: AbortSignal.any([sharedSignal, controller.signal]), sharedSignal,
      penalized: false,
      remainingMs: () => Math.max(0, deadlineAt - performance.now()),
      text: text => {
        if (!text) return;
        prefix += text;
        if (!received && !prefix.trim()) return;
        if (choose()) { options.emit?.('delta', { text: prefix }); prefix = ''; }
      },
      reset: () => { if (selected === attempt && !finished) options.emit?.('reset', {}); },
    };
    const checkLate = () => {
      if (!received && !settled && !finished && !attempt.signal.aborted && performance.now() - started >= 5000) penalize('timeout');
    };
    const timer = setTimeout(checkLate, 5000);
    attempts.push({ attempt, controller, timer, checkLate });
    // Attach both handlers immediately so late/cancelled requests cannot leak
    // an unhandled rejection or replace the chosen answer.
    void options.run(attempt).then(value => {
      if (attempt.signal.aborted || finished) return;
      if (choose()) { finished = true; resolve({ value, attempt }); }
    }, error => {
      if (attempt.signal.aborted || finished) return;
      if (performance.now() >= deadlineAt) { stop(new ModelsUnavailable(true)); return; }
      const reason = options.classify(error);
      if (reason === null) { stop(error); return; }
      penalize(reason);
      if (selected === attempt) stop(new ModelsUnavailable());
    }).finally(() => {
      settled = true; pending--; clearTimeout(timer);
      if (!finished && launched === options.models.length && !pending) stop(new ModelsUnavailable());
    });
  }

  try {
    launch(options.models[0]);
    for (let i = 1; i < options.models.length; i++) {
      timers.add(setTimeout(() => launch(options.models[i]), i * 5000));
    }
    return await result;
  } finally {
    finished = true;
    clearTimeout(expire);
    for (const timer of timers) clearTimeout(timer);
    for (const { timer } of attempts) clearTimeout(timer);
    options.signal.removeEventListener('abort', abort);
    lifetime.abort(new DOMException('Model request finished', 'AbortError'));
  }
}
