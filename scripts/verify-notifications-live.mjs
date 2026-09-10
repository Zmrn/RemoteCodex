// Read-only official projection check. No messages, read receipts or UI navigation.
import fs from 'node:fs';
import path from 'node:path';
import { Bridge, ROOT } from '../src/bridge.mjs';
import { NotificationSource } from '../src/notification-source.mjs';
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
const dir = fs.mkdtempSync(path.join(ROOT, 'work/notification-live-'));
const bridge = new Bridge(dir);
try {
  await bridge.connect();
  const source = new NotificationSource(bridge), result = await source.collect();
  const report = { result: result.supported && result.threads.some(t => t.known) ? 'PASS' : 'UNAVAILABLE',
    supported: result.supported, officialVersion: bridge.status().desktopCompatibility?.detectedVersion,
    sampled: result.threads.length, known: result.threads.filter(t => t.known).length, partial: result.partial,
    events: result.threads.flatMap(t => t.events ?? []).reduce((out, e) => { out[e.kind] = (out[e.kind] ?? 0) + 1; return out; }, {}),
    taskWrites: 0, readReceipts: 0, chatNotificationsTested: false };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  if (report.result !== 'PASS') process.exitCode = 1;
} finally { bridge.disconnect(); }
