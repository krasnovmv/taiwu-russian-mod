/**
 * Thin adapter over `cli-progress` exposing the small API the CLIs use. Renders
 * to stderr (so stdout stays clean for piped results) and stays silent when
 * stderr is not a TTY.
 */
import cliProgress from "cli-progress";

const SUFFIX_MAX = 60;

function clip(text: string): string {
  return text.length > SUFFIX_MAX ? `${text.slice(0, SUFFIX_MAX - 1)}…` : text;
}

export class Progress {
  private readonly bar: cliProgress.SingleBar;
  private current = 0;

  constructor(
    private readonly total: number,
    label: string,
  ) {
    this.bar = new cliProgress.SingleBar(
      {
        format: `${label} [{bar}] {value}/{total} {percentage}% {suffix}`,
        stream: process.stderr,
        noTTYOutput: false,
        hideCursor: true,
        clearOnComplete: false,
        forceRedraw: false,
      },
      cliProgress.Presets.shades_classic,
    );
    this.bar.start(total, 0, { suffix: "" });
  }

  /** Advance by one step, optionally updating the trailing text. */
  increment(suffix = ""): void {
    this.current++;
    this.bar.update(this.current, { suffix: clip(suffix) });
  }

  /** Re-render with new trailing text without advancing (sub-progress). */
  note(suffix: string): void {
    this.bar.update(this.current, { suffix: clip(suffix) });
  }

  /** Finish the bar and move to a new line. */
  finish(suffix = ""): void {
    this.bar.update(this.total, { suffix: clip(suffix) });
    this.bar.stop();
  }
}
