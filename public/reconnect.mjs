// Viewing recovery only: callers must never submit task mutations here.
export class Reconnector {
  constructor(
    run,
    {
      delays = [1000, 2000, 4000, 8000, 15000, 30000],
      onRetry = () => {},
    } = {},
  ) {
    this.run = run;
    this.delays = delays;
    this.onRetry = onRetry;
    this.enabled = true;
    this.failures = 0;
  }
  request(immediate = false) {
    if (!this.enabled) return;
    if (this.running) {
      this.pending = true;
      return;
    }
    if (this.timer && !immediate) return;
    clearTimeout(this.timer);
    const delay = immediate
      ? 0
      : this.delays[Math.min(this.failures, this.delays.length - 1)];
    this.onRetry(delay);
    this.timer = setTimeout(() => this.attempt(), delay);
    this.timer.unref?.();
  }
  healthy() {
    this.failures = 0;
  }
  async attempt() {
    this.timer = null;
    if (!this.enabled || this.running) return;
    this.onRetry(0);
    const controller = new AbortController();
    this.running = controller;
    this.pending = false;
    this.failures++;
    try {
      await this.run(controller.signal);
    } catch {
      if (!controller.signal.aborted) this.pending = true;
    } finally {
      this.running = null;
      if (this.pending) this.request();
    }
  }
  stop() {
    this.enabled = false;
    clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
    this.running?.abort();
  }
}
