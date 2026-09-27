import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bridge } from '../src/bridge.mjs';
import { goalInput, goalPrompt } from '../src/official-goal.mjs';
import { allowedRoute } from '../src/remote.mjs';

const id = '11111111-1111-4111-8111-111111111111';

test('Goal input is bounded and its official tool request carries the exact objective', () => {
  const objective = '完成 A 项\n然后检查 B 项';
  const goal = goalInput(objective, 1200);
  assert.deepEqual(goal, { objective, tokenBudget: 1200 });
  for (const edit of [false, true]) {
    const prompt = goalPrompt(goal, { edit });
    assert.deepEqual(JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1)),
      { objective, token_budget: 1200 });
    assert.match(prompt, /Goal 工具|create_goal 工具/);
  }
  assert.throws(() => goalInput(' ', undefined));
  assert.throws(() => goalInput('a'.repeat(4001), undefined));
  assert.throws(() => goalInput('valid', 0));
  assert.throws(() => goalInput('valid', 1.5));
});

test('Goal creation uses the desktop-owned conversation and confirms the official record', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-goal-create-'));
  const calls = [];
  const reader = { close() {}, connect: async () => {}, awaitObjective: async (home, threadId, objective) => {
    calls.push({ home, threadId, objective });
    return { confirmed: true, goal: { objective, status: 'active' } };
  } };
  const bridge = new Bridge(dir, { goalReader: reader });
  bridge.connected = true;
  t.after(() => { bridge.disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  bridge.createTask = async (key, prompt, settings, project, images, probe, onCreated) => {
    calls.push({ key, prompt, settings, project, images, probe });
    onCreated?.(id);
    return { status: 'accepted', result: { threadId: id } };
  };
  bridge.officialDataHome = () => 'C:\\official-home';
  const result = await bridge.createGoal('goal-create-123', '完成清单', 400, {}, null);
  assert.equal(result.goalConfirmation.confirmed, true);
  assert.equal(calls[0].key, 'goal-create-123');
  assert.equal(JSON.parse(calls[0].prompt.slice(calls[0].prompt.lastIndexOf('\n') + 1)).objective, '完成清单');
  assert.deepEqual(calls[1], { home: 'C:\\official-home', threadId: id, objective: '完成清单' });
});

test('Goal display follows the official record rather than a stale desktop event', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-goal-read-'));
  let stored = null;
  const reader = { close() {}, get: async () => stored };
  const bridge = new Bridge(dir, { goalReader: reader });
  bridge.connected = true;
  bridge.codexThread = async () => ({ thread: { kind: 'codex' } });
  bridge.officialDataHome = () => 'C:\\official-home';
  bridge.live.set(id, { state: { completedThreadGoal: { objective: '旧目标', threadId: id } } });
  t.after(() => { bridge.disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.equal((await bridge.goal(id)).goal, null);
  stored = { objective: '新目标', status: 'active' };
  const result = await bridge.goal(id);
  assert.deepEqual(result.goal, stored);
  assert.equal(result.desktopSynced, false);
  assert.equal(result.source, 'official-codex-app-server-goal-get');
});

test('Goal editing persists through the official set API and then syncs the owner', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-goal-edit-'));
  const reader = { close() {}, set: async (_home, _id, goal) => ({ ...goal, status: 'active' }) };
  const bridge = new Bridge(dir, { goalReader: reader });
  t.after(() => { bridge.disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  bridge.connected = true;
  bridge.goal = async () => ({ goal: { objective: '旧目标', tokenBudget: 500, status: 'active' }, desktopSynced: true });
  bridge.officialDataHome = () => 'C:\\official-home';
  let status = 'active';
  bridge.codexThread = async () => ({ thread: { kind: 'codex', status: { type: status } } });
  const calls = [];
  bridge.nativeSteer = async (...args) => {
    calls.push(['steer', ...args]);
    bridge.live.set(id, { state: { threadGoal: { objective: '新目标', status: 'active' } } });
    return { status: 'accepted' };
  };
  bridge.nativeSend = async (...args) => {
    calls.push(['send', ...args]);
    bridge.live.set(id, { state: { threadGoal: { objective: '另一目标', status: 'active' } } });
    return { status: 'accepted' };
  };
  const active = await bridge.updateGoal(id, 'goal-edit-123', '新目标', undefined, 'turn-1');
  assert.equal(active.goalConfirmation.confirmed, true);
  assert.equal(active.ownerSync.confirmed, true);
  assert.equal(calls[0][0], 'steer');
  assert.equal(calls[0].at(-1), 'turn-1');
  assert.equal(JSON.parse(calls[0][3].slice(calls[0][3].lastIndexOf('\n') + 1)).objective, '新目标');
  status = 'idle';
  await bridge.updateGoal(id, 'goal-edit-456', '另一目标');
  assert.equal(calls[1][0], 'send');
  assert.equal(calls.length, 2);
});

test('Goal routes are available through remote forwarding only for supported methods', () => {
  assert.equal(allowedRoute('GET', `/api/threads/${id}/goal`), true);
  assert.equal(allowedRoute('POST', `/api/threads/${id}/goal`), true);
  assert.equal(allowedRoute('DELETE', `/api/threads/${id}/goal`), false);
});
