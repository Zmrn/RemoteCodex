// Creates one NEW dedicated test task. Every write is guarded to that task.
// Never automate the official UI or write its files. Never replay this run.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Bridge, ROOT } from '../src/bridge.mjs';
import { OfficialReadState } from '../src/official-read-state.mjs';
import { assertProbeTarget } from '../src/probe-safety.mjs';
import { desktopCompatibility } from '../src/official-protocol.mjs';
import { runtimeStatus } from '../src/state.mjs';
if (!process.argv.includes('--create-probe')) throw Error('Explicit --create-probe is required');
const dir = fs.mkdtempSync(path.join(ROOT, 'work/official-read-roundtrip-')), b = new Bridge(path.join(dir, 'data'));
const report = { phase: 'running', checks: [], taskMessages: 0, apkExecuted: false };
const save = () => fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(report, null, 2));
const check = (name, value) => { assert.ok(value, name); report.checks.push(name); save(); console.log('PASS ' + name); };
const until = async fn => { const end = Date.now() + 90000; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 700)); } throw Error('Timed out; no writes will be replayed'); };
let id;
try {
  await b.connect();
  report.version = desktopCompatibility(b.desktop.identity.appToolsPipe.image).detectedVersion;
  report.connection = b.desktop.identity.connection; save();
  check('exact supported official build', report.version === '26.903.8094.0');
  const reader = new OfficialReadState(b.desktop), context = await reader.context();
  check('login identity and default local execution partition available without exposing tokens', context && await reader.marked(context, randomUUID()) === false);
  const created = await b.createProbe('read-sync-create-' + randomUUID(), 'Remote Codex 已读同步专用验证任务。只回复 READ_SYNC_FIRST_OK，不要使用工具，不要修改文件。');
  id = created.result?.threadId; assertProbeTarget({ testThreads: b.db.tests }, id);
  report.taskId = id; report.taskMessages++; save();
  const guarded = b.markOfficialReportRead.bind(b);
  b.markOfficialReportRead = (target, token) => { assertProbeTarget({ testThreads: b.db.tests }, target); return guarded(target, token); };
  const ready = async old => { const r = await b.read(id); return r.reportReceipt && r.reportReceipt.token !== old && runtimeStatus(b.live.get(id)?.state).type === 'completed' ? r : null; };
  const first = await until(() => ready());
  check('first completed report has official unread marker', await until(() => reader.marked(context, id)));
  let acknowledged = await b.taskReports.acknowledge(id, first.reportReceipt.token);
  check('Remote Codex read clears official persisted unread marker', acknowledged.accepted && acknowledged.officialReadSync?.status === 'synced' && await reader.marked(context, id) === false);
  await b.follow(id);
  check('official owner snapshot also clears the unread marker', await until(() => b.live.get(id)?.state?.hasUnreadTurn === false));
  assertProbeTarget({ testThreads: b.db.tests }, id);
  await b.nativeSend(id, 'read-sync-next-' + randomUUID(), '继续这条专用验证任务，只回复 READ_SYNC_SECOND_OK，不要使用工具。');
  report.taskMessages++; save();
  const second = await until(() => ready(first.reportReceipt.token));
  check('new completed report becomes unread again', await until(() => reader.marked(context, id)));
  acknowledged = await b.taskReports.acknowledge(id, first.reportReceipt.token);
  check('delayed previous report acknowledgement does not clear new official unread marker', acknowledged.officialReadSync?.status === 'report-changed' && await reader.marked(context, id) === true);
  acknowledged = await b.taskReports.acknowledge(id, second.reportReceipt.token);
  check('reading new report clears its official marker', acknowledged.officialReadSync?.status === 'synced' && await reader.marked(context, id) === false);
  report.phase = 'passed'; save();
} catch (error) { report.phase = 'failed'; report.error = error.message; save(); console.error(error.message); process.exitCode = 1; }
finally { b.disconnect(); clearInterval(b.subscriptionTimer); console.log(JSON.stringify({ phase: report.phase, checks: report.checks.length, directory: dir })); }
