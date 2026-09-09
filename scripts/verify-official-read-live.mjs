// Read-only official metadata check. No UI automation, task writes or receipts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Desktop } from '../src/desktop.mjs';
import { TaskReports } from '../src/task-reports.mjs';
import { TOOLS, desktopCompatibility } from '../src/official-protocol.mjs';
const desktop = new Desktop(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'official-read-live-'));
try {
  await desktop.connect();
  const bridge = { desktop, dataDir: dir, requireConnection() { if (desktop.tools.socket.destroyed || desktop.ipc.socket.destroyed) throw Error('Disconnected'); },
    threads: async (limit, options) => ({ data: await desktop.call(TOOLS.listThreads, { limit }, undefined, options) }) };
  const summary = await new TaskReports(bridge).summary();
  console.log(JSON.stringify({ version: desktopCompatibility(desktop.identity.appToolsPipe.image).detectedVersion,
    connection: desktop.identity.connection, officialReadState: summary.officialReadState,
    tasks: summary.threads.length, running: summary.threads.filter(t => t.running).length,
    unread: summary.threads.filter(t => t.unread).length, officialExclusions: summary.threads.filter(t => t.officialRead).length,
    unknown: summary.threads.filter(t => t.unknown).length, complete: summary.complete,
    taskWrites: 0, receiptFilesCreated: fs.readdirSync(dir).length, apkExecuted: false }, null, 2));
  if (summary.officialReadState.status !== 'available' || fs.readdirSync(dir).length) process.exitCode = 1;
} finally { desktop.close(); fs.rmSync(dir, { recursive: true, force: true }); }
