import assert from 'node:assert/strict';
import test from 'node:test';
import { ProgressStore } from '../assets/progress-store.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const empty = () => ({ version: 1, bank: 'test', current: 1, updatedAt: 0, filter: 'all', query: '', records: {} });
const changed = (id = 1) => ({ ...empty(), current: id, updatedAt: id, records: { [id]: { selected: ['A'], checked: true, flagged: false, updatedAt: id } } });
const validate = state => { assert.equal(state.bank, 'test'); return copy(state); };
function fixture(t, initial = null, cached = null) {
  let remote = { revision: initial ? 1 : 0, state: initial };
  let disk = cached;
  const modes = [];
  const api = {
    async load() { return copy(remote); },
    async save(revision, state) {
      if (revision !== remote.revision) return { ...copy(remote), conflict: true };
      remote = { revision: revision + 1, state: copy(state) };
      return { ...copy(remote), conflict: false };
    },
  };
  const cache = { async read() { return copy(disk); }, async write(entry) { disk = copy(entry); return true; } };
  const store = new ProgressStore({ api, cache, empty, validate, delay: 60000, onStatus: mode => modes.push(mode) });
  t.after(() => store.dispose());
  return { store, api, modes, get disk() { return disk; }, get remote() { return remote; }, set remote(value) { remote = value; } };
}

test('a new account starts empty and saves with its expected revision', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.store.load(), empty());
  f.store.update(changed());
  assert.equal(await f.store.flush(), true);
  assert.equal(f.remote.revision, 1);
  assert.deepEqual(f.remote.state, changed());
  assert.equal(f.disk.pending, false);
});

test('an unsaved snapshot survives reload and retries', async t => {
  const f = fixture(t, null, { revision: 0, state: changed(), pending: true });
  assert.deepEqual(await f.store.load(), changed());
  assert.equal(await f.store.flush(), true);
  assert.deepEqual(f.remote.state, changed());
});

test('a stale device never overwrites a newer device', async t => {
  const f = fixture(t, changed(1));
  await f.store.load();
  f.remote = { revision: 2, state: changed(2) };
  f.store.update(changed(3));
  assert.equal(await f.store.flush(), false);
  assert.equal(f.store.conflict, true);
  assert.deepEqual(f.remote.state, changed(2));
  assert.deepEqual(f.disk.state, changed(3));
  assert.equal(f.disk.pending, true);
});

test('pending progress conflicts after another device resets or edits it', async t => {
  const f = fixture(t, empty(), { revision: 0, state: changed(3), pending: true });
  assert.deepEqual(await f.store.load(), changed(3));
  assert.equal(f.store.conflict, true);
  assert.equal(await f.store.flush(), false);
  assert.deepEqual(f.remote.state, empty());
  assert.equal(f.disk.revision, 0, 'a conflict must retain the original expected revision across reloads');
});

test('a lost save response is recovered without double applying the write', async t => {
  const f = fixture(t);
  await f.store.load();
  const save = f.api.save;
  let first = true;
  f.api.save = async (...args) => {
    const result = await save(...args);
    if (first) { first = false; throw Error('Response lost'); }
    return result;
  };
  f.store.update(changed());
  assert.equal(await f.store.flush(), false);
  assert.equal(await f.store.flush(), true);
  assert.equal(f.remote.revision, 1);
  assert.equal(f.disk.pending, false);
});

test('edits made during a save are sent with the next revision', async t => {
  const f = fixture(t);
  await f.store.load();
  let unblock, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { unblock = resolve; });
  const save = f.api.save;
  let first = true;
  f.api.save = async (...args) => {
    if (first) { first = false; started(); await gate; }
    return save(...args);
  };
  f.store.update(changed(1));
  const flushed = f.store.flush();
  await waiting;
  f.store.update(changed(2));
  unblock();
  assert.equal(await flushed, true);
  assert.equal(f.remote.revision, 2);
  assert.deepEqual(f.remote.state, changed(2));
});

test('explicitly loading server progress resolves a conflict', async t => {
  const f = fixture(t, changed(1));
  await f.store.load();
  f.remote = { revision: 2, state: changed(2) };
  f.store.update(changed(3));
  await f.store.flush();
  assert.deepEqual(await f.store.useRemote(), changed(2));
  assert.equal(f.store.dirty, false);
  assert.equal(f.store.conflict, false);
  assert.equal(f.disk.pending, false);
});

test('offline loading uses only that account cache and does not claim a server save', async t => {
  const f = fixture(t, null, { revision: 3, state: changed(3), pending: true });
  f.api.load = async () => { throw Error('Offline'); };
  assert.deepEqual(await f.store.load(), changed(3));
  assert.equal(f.modes.at(-1), 'offline');
  assert.equal(f.store.revision, 3);
});

test('refresh accepts newer progress only while no local edit is pending', async t => {
  const f = fixture(t, changed(1));
  await f.store.load();
  f.remote = { revision: 2, state: changed(2) };
  await f.store.refresh();
  assert.deepEqual(f.store.state, changed(2));
  f.store.update(changed(3));
  f.remote = { revision: 3, state: changed(4) };
  await f.store.refresh();
  assert.deepEqual(f.store.state, changed(3));
  assert.deepEqual(f.remote.state, changed(4));
  assert.equal(f.store.conflict, true);
});
