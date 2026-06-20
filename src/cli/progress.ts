/**
 * Terminal progress bars (cli-progress). Rendered to stderr so stdout stays
 * clean for piped results, and only when stderr is a TTY — when redirected to a
 * file or pipe the bars are a no-op (no garbled output in logs).
 */
import cliProgress from "cli-progress";

const isTty = process.stderr.isTTY === true;
const SUFFIX_MAX = 60;

function clip(text: string): string {
  return text.length > SUFFIX_MAX ? `${text.slice(0, SUFFIX_MAX - 1)}…` : text;
}

const BAR_OPTS = {
  stream: process.stderr,
  hideCursor: true,
  clearOnComplete: false,
  forceRedraw: false,
} as const;

/** Single bar over a list of items (files). No-op when not a TTY. */
export class Progress {
  private readonly bar: cliProgress.SingleBar | null;
  private current = 0;

  constructor(
    private readonly total: number,
    label: string,
  ) {
    if (!isTty) {
      this.bar = null;
      return;
    }
    this.bar = new cliProgress.SingleBar(
      { ...BAR_OPTS, format: `${label} [{bar}] {value}/{total} {percentage}% {suffix}` },
      cliProgress.Presets.shades_classic,
    );
    this.bar.start(total, 0, { suffix: "" });
  }

  /** Advance by one step, optionally updating the trailing text. */
  increment(suffix = ""): void {
    this.current++;
    this.bar?.update(this.current, { suffix: clip(suffix) });
  }

  /** Re-render with new trailing text without advancing (sub-progress). */
  note(suffix: string): void {
    this.bar?.update(this.current, { suffix: clip(suffix) });
  }

  /** Finish the bar and move to a new line. */
  finish(suffix = ""): void {
    this.bar?.update(this.total, { suffix: clip(suffix) });
    this.bar?.stop();
  }
}

/**
 * Two stacked bars for `translate`: overall files progress plus units within the
 * current file. No-op when not a TTY.
 */
export class FileProgress {
  private readonly multibar: cliProgress.MultiBar | null;
  private readonly filesBar: cliProgress.SingleBar | null;
  private readonly unitBar: cliProgress.SingleBar | null;

  constructor(totalFiles: number) {
    if (!isTty) {
      this.multibar = null;
      this.filesBar = null;
      this.unitBar = null;
      return;
    }
    this.multibar = new cliProgress.MultiBar(
      { ...BAR_OPTS, format: "{name} [{bar}] {value}/{total} {percentage}% {suffix}" },
      cliProgress.Presets.shades_classic,
    );
    this.filesBar = this.multibar.create(totalFiles, 0, { name: "files", suffix: "" });
    this.unitBar = this.multibar.create(0, 0, { name: "units", suffix: "" });
  }

  /** Begin a file: reset the unit bar to its unit total and show the file name. */
  startFile(file: string, totalUnits: number): void {
    this.unitBar?.setTotal(totalUnits);
    this.unitBar?.update(0, { name: "units", suffix: clip(file) });
  }

  /** Update units done within the current file. */
  unit(done: number): void {
    this.unitBar?.update(done);
  }

  /** Finish the current file and advance the files bar. */
  finishFile(): void {
    this.unitBar?.update(this.unitBar.getTotal());
    this.filesBar?.increment();
  }

  stop(): void {
    this.multibar?.stop();
  }
}
