import { randomUUID } from 'node:crypto';
import { SAMPLE_MS, historyWindows } from './usage-history.mjs';

// Collect on the target even with no viewer. A disconnected official app is a
// gap, never a zero. Reads of stored history never require an official connection.
export class UsageRecorder {
  constructor(bridge, history, { intervalMs = SAMPLE_MS, now = Date.now } = {}) {
    Object.assign(this, { bridge, history, intervalMs, now });
    this.segment = randomUUID(); this.stopped = true; this.lastError = ''; this.lastAttemptAt = null;
    this.onUsage = usage => {
      if (this.stopped || !this.bridge.connected) return;
      try {
        const known = historyWindows(usage).map(w => JSON.stringify([w.limitId, w.duration])).sort().join('|');
        if (this.known !== undefined && this.known !== known) this.segment = randomUUID();
        this.known = known;
        this.history.record(usage, this.segment); this.lastError = '';
      }
      catch { this.lastError = '额度记录未能保存，已有数据已保留；请检查目标设备的数据目录'; }
      if (usage.status !== 'available') this.segment = randomUUID();
    };
    this.onEvent = e => {
      if (e.kind === 'connected' || e.kind === 'connection-interrupted') this.segment = randomUUID();
      if (e.kind === 'connected') this.poll();
    };
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.bridge.on('usage', this.onUsage); this.bridge.on('event', this.onEvent);
    this.timer = setInterval(() => { this.prune(); this.poll(); }, this.intervalMs); this.timer.unref();
    this.prune(); this.poll();
  }
  prune() {
    try { this.history.prune(); }
    catch { this.lastError = '额度历史维护失败，原文件已保留；请检查目标设备的数据目录'; }
  }
  async poll() {
    if (this.stopped || this.pending || !this.bridge.connected || typeof this.bridge.usage !== 'function') return;
    this.lastAttemptAt = this.now();
    this.pending = true;
    try { await this.bridge.usage(); }
    catch {
      if (!this.stopped) { this.lastError = '最近一次官方额度读取失败；这段时间没有记录'; this.segment = randomUUID(); }
    } finally { this.pending = false; }
  }
  read(days) {
    if (![1, 7, 30].includes(days)) throw Error('仅支持最近 1 天、7 天或 30 天');
    try {
      return { ...this.history.read(days), recording: { connected: !!this.bridge.connected,
        lastAttemptAt: this.lastAttemptAt, error: this.lastError } };
    } catch (cause) {
      throw Error('额度历史暂不可读，原文件已保留；请在目标设备检查可用空间或稍后重试', { cause });
    }
  }
  close() {
    this.stopped = true; clearInterval(this.timer);
    this.bridge.off('usage', this.onUsage); this.bridge.off('event', this.onEvent); this.history.close();
  }
}
