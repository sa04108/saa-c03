import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const bank = 'saa-c03-684-20260926-v1';
const state = (current = 1) => ({ version: 1, bank, current, updatedAt: 1, filter: 'all', query: '', records: { 1: { selected: ['A'], checked: true, flagged: false, updatedAt: 1 } } });
let db;
async function actAs(role, id = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec(`set role ${role}`);
}
async function save(id, revision = 0, value = state(), bankId = bank) {
  const result = await db.query('select public.save_study_progress($1::uuid,$2::text,$3::bigint,$4::jsonb) as result', [id, bankId, revision, JSON.stringify(value)]);
  return result.rows[0].result;
}
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/202610300001_study_progress.sql', import.meta.url), 'utf8'));
  await db.query('insert into auth.users(id) values ($1),($2)', [A, B]);
});
beforeEach(async () => { await db.exec('reset role; truncate public.study_progress'); });
after(async () => { await db?.close(); });

test('signed-out visitors cannot read or write progress', async () => {
  await actAs('anon');
  await assert.rejects(db.query('select * from public.study_progress'), { code: '42501' });
  await assert.rejects(save(A), { code: '42501' });
});

test('users can save and read their own account only', async () => {
  await actAs('authenticated', A);
  assert.equal((await save(A)).revision, 1);
  await actAs('authenticated', B);
  assert.deepEqual((await db.query('select user_id from public.study_progress')).rows, []);
  await save(B, 0, state(2));
  await actAs('authenticated', A);
  assert.deepEqual((await db.query('select user_id from public.study_progress')).rows, [{ user_id: A }]);
});

test('the RPC refuses a forged or changed account ID', async () => {
  await actAs('authenticated', B);
  await save(B, 0, state(2));
  await actAs('authenticated', A);
  await assert.rejects(save(B, 1, state(3)), { code: '42501' });
  await actAs('authenticated', B);
  assert.equal((await db.query('select state from public.study_progress')).rows[0].state.current, 2);
});

test('direct writes cannot bypass revision checks', async () => {
  await actAs('authenticated', A);
  await save(A);
  await assert.rejects(db.query('update public.study_progress set revision=100'), { code: '42501' });
  await assert.rejects(db.query('delete from public.study_progress'), { code: '42501' });
  await assert.rejects(db.query('insert into public.study_progress values ($1,$2,1,$3,now())', [A, bank, JSON.stringify(state())]), { code: '42501' });
});

test('stale or concurrent saves return a conflict without changing the row', async () => {
  await actAs('authenticated', A);
  assert.equal((await save(A)).revision, 1);
  const conflict = await save(A, 0, state(2));
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.state.current, 1);
  assert.equal((await save(A, 1, state(3))).revision, 2);
  const stale = await save(A, 1, state(4));
  assert.equal(stale.conflict, true);
  assert.equal(stale.state.current, 3);
});

test('invalid progress, bank IDs and oversized payloads are rejected', async () => {
  await actAs('authenticated', A);
  const invalid = [null, { ...state(), current: 685 }, { ...state(), records: [] },
    { ...state(), records: { 1: { selected: ['A', 'A'], checked: false, flagged: false, updatedAt: 1 } } },
    { ...state(), query: 'x'.repeat(524289) }];
  for (const value of invalid) await assert.rejects(save(A, 0, value));
  await assert.rejects(save(A, 0, state(), 'other-bank'));
  assert.deepEqual((await db.query('select * from public.study_progress')).rows, []);
});
