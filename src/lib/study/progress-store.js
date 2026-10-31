const clone = (value) => JSON.parse(JSON.stringify(value));
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
const same = (left, right) => canonical(left) === canonical(right);

// Every instance belongs to one immutable user ID and question bank.
// Optimistic revisions prevent an old device from overwriting newer progress.
export class ProgressStore {
  constructor({
    api,
    cache,
    empty,
    validate,
    onStatus = () => {},
    onRemote = () => {},
    delay = 700,
  }) {
    Object.assign(this, {
      api,
      cache,
      empty,
      validate,
      onStatus,
      onRemote,
      delay,
    });
    this.revision = 0;
    this.state = null;
    this.dirty = false;
    this.conflict = false;
    this.stopped = false;
    this.durable = true;
    this.cacheQueue = Promise.resolve();
  }

  status(mode) {
    this.mode = mode;
    if (!this.stopped) this.onStatus(mode, { durable: this.durable });
  }

  async remember() {
    const entry = {
      revision: this.revision,
      state: clone(this.state),
      pending: this.dirty,
    };
    this.cacheQueue = this.cacheQueue
      .catch(() => {})
      .then(async () => {
        try {
          this.durable = await this.cache.write(entry);
        } catch {
          this.durable = false;
        }
      });
    await this.cacheQueue;
  }

  async load() {
    let cached = null;
    try {
      cached = await this.cache.read();
      if (cached) {
        cached.state = this.validate(cached.state);
        if (
          !Number.isSafeInteger(cached.revision) ||
          cached.revision < 0 ||
          typeof cached.pending !== "boolean"
        )
          cached = null;
      }
    } catch {
      cached = null;
    }
    let remote;
    try {
      remote = await this.api.load();
    } catch (error) {
      if (!cached) throw error;
      this.state = cached.state;
      this.revision = cached.revision;
      this.dirty = cached.pending;
      this.status("offline");
      if (this.dirty) this.schedule(10000);
      return clone(this.state);
    }
    this.revision = remote.revision;
    const state = this.validate(remote.state || this.empty());
    if (cached?.pending && !same(cached.state, state)) {
      this.state = cached.state;
      this.dirty = true;
      this.conflict = cached.revision !== remote.revision;
      this.revision = cached.revision;
      await this.remember();
      this.status(this.conflict ? "conflict" : "pending");
      if (!this.conflict) this.schedule();
    } else {
      this.state = state;
      await this.remember();
      this.status("saved");
    }
    return clone(this.state);
  }

  update(state) {
    if (this.stopped) return;
    this.state = this.validate(clone(state));
    this.dirty = true;
    void this.remember();
    this.status(this.conflict ? "conflict" : "pending");
    if (!this.conflict) this.schedule();
  }

  schedule(delay = this.delay) {
    clearTimeout(this.timer);
    if (!this.stopped)
      this.timer = setTimeout(() => {
        void this.flush();
      }, delay);
  }

  async flush() {
    clearTimeout(this.timer);
    if (this.stopped || this.conflict) return false;
    if (this.flushing) return this.flushing;
    if (!this.dirty) return true;
    this.flushing = this.performFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  async performFlush() {
    this.status("syncing");
    try {
      while (this.dirty && !this.stopped) {
        const sent = clone(this.state);
        await this.remember();
        const result = await this.api.save(this.revision, sent);
        if (this.stopped) return false;
        if (result.conflict && !same(result.state, sent)) {
          this.conflict = true;
          this.status("conflict");
          return false;
        }
        this.revision = result.revision;
        this.dirty = !same(this.state, sent);
        await this.remember();
      }
      this.status("saved");
      return true;
    } catch {
      this.status("offline");
      this.schedule(10000);
      return false;
    }
  }

  async refresh() {
    if (this.stopped || this.conflict) return;
    if (this.dirty || this.flushing) return this.flush();
    try {
      const result = await this.api.load();
      if (this.dirty || this.flushing || this.stopped) return;
      if (result.revision !== this.revision) {
        this.state = this.validate(result.state || this.empty());
        this.revision = result.revision;
        await this.remember();
        this.onRemote(clone(this.state));
      }
      this.status("saved");
    } catch {
      this.status("offline");
    }
  }

  async useRemote() {
    if (this.flushing) await this.flushing;
    const result = await this.api.load();
    this.state = this.validate(result.state || this.empty());
    this.revision = result.revision;
    this.conflict = this.dirty = false;
    clearTimeout(this.timer);
    await this.remember();
    this.onRemote(clone(this.state));
    this.status("saved");
    return clone(this.state);
  }

  dispose() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
