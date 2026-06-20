/**
 * Minimal zero-dependency terminal progress bar.
 *
 * Renders to stderr (so stdout stays clean for piped results) and only when
 * stderr is a TTY — under redirection it is silent. Renders are throttled to
 * avoid flicker on fast loops.
 */
const BAR_WIDTH = 24;
const RENDER_INTERVAL_MS = 80;

export class Progress {
  private current = 0;
  private lastRender = 0;
  private readonly isTty = process.stderr.isTTY === true;

  constructor(
    private readonly total: number,
    private readonly label: string,
  ) {}

  /** Advance by one step, optionally updating the trailing text. */
  increment(suffix = ""): void {
    this.current++;
    this.render(suffix, true);
  }

  /** Re-render with new trailing text without advancing (e.g. sub-progress). */
  note(suffix: string): void {
    this.render(suffix, false);
  }

  /** Finish the bar and move to a new line. */
  finish(suffix = ""): void {
    if (!this.isTty) return;
    this.current = this.total;
    this.render(suffix, true);
    process.stderr.write("\n");
  }

  private render(suffix: string, force: boolean): void {
    if (!this.isTty) return;
    const now = Date.now();
    if (!force && now - this.lastRender < RENDER_INTERVAL_MS) return;
    this.lastRender = now;

    const ratio = this.total > 0 ? Math.min(1, this.current / this.total) : 1;
    const filled = Math.round(ratio * BAR_WIDTH);
    const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
    const pct = (ratio * 100).toFixed(0).padStart(3);
    const line = `${this.label} [${bar}] ${this.current}/${this.total} ${pct}% ${suffix}`;
    const max = (process.stderr.columns ?? 120) - 1;
    process.stderr.write(`\r${line.length > max ? line.slice(0, max) : line}\x1b[K`);
  }
}
