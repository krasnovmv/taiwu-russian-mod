/**
 * A short, self-resetting conversation with the judge model.
 *
 * The backends are stateless HTTP: a "session" simply means resending the earlier
 * turns of this conversation with the next request, so the model answers turn N
 * having already seen turns 1…N-1. Two things follow from that, and they pull in
 * opposite directions:
 *
 *   + The model has already been put to work on the task, so it deliberates less
 *     on later turns. Measured against the current backend on BATCHED turns of 40
 *     units: reasoning tokens 5870 vs 9940 (-41%) and throughput 2.31 vs 1.64
 *     units/s (+41%), consistent across three interleaved A/B repetitions.
 *   + The re-sent history is a stable prefix, so it lands in the backend's prompt
 *     cache. Over the same A/B the UNCACHED prompt tokens came out level with the
 *     stateless run (47 647 vs 46 871) even though the raw prompt grew 72% — the
 *     growth is paid for by cache hits, not by tokens.
 *   - The prompt still grows with every turn, and a long conversation eventually
 *     costs real context. Hence {@link ChatSession.maxTurns}: a window, not an
 *     ever-growing chat.
 *
 * A full window RESTARTS the conversation; it deliberately does not slide the
 * oldest turn out. Sliding was built and measured against restarting, and lost on
 * the trade: it keeps every turn warm, but once the window is full everything
 * after the system prompt shifts on each turn, so the only stable prefix left is
 * the system prompt — 1707 tokens, under this backend's ~2048-token caching
 * threshold — and uncached prompt tokens rose 76% for a speed edge that ranged
 * from +30% to +6% across runs, i.e. smaller than the backend's own drift. On
 * output the two were indistinguishable: over 240 units judged twice each, the
 * three defects only restarting found were all either minor (never rewritten) or
 * rewrites the QA gates rejected, so none would have reached the TM.
 *
 * IMPORTANT, measured: the win above is a property of BATCHED turns. With one
 * unit per turn sessions came out 20-25% SLOWER than stateless requests
 * (0.25-0.27 vs 0.33 units/s over four paired runs), because a single short unit
 * triggers almost no deliberation to begin with, so there is nothing for the
 * warm-up to save. The judge now batches (`TAIWU_JUDGE_BATCH`), so a turn is a
 * whole batch and the +41% is the expected direction — but that number came off a
 * hand-rolled batch, not off this pipeline, so `TAIWU_JUDGE_SESSION_TURNS` still
 * defaults to 1 until a real run says otherwise.
 *
 * A turn only joins the history once its answer proved usable — see
 * {@link ChatSession.rollback}. A conversation that kept an unparseable reply, or
 * a rewrite the QA gates threw away, would be showing the model its own bad work
 * as an example of the expected answer.
 */
import type { ChatClient, ChatMessage, ChatOptions } from "../engine/chat-client.js";

/**
 * Default characters of history after which the conversation restarts early,
 * whatever `maxTurns` says. A guard for outliers, not a tuning knob: a handful of
 * long prose units in one window would otherwise push the request toward the
 * model's context limit, which fails as a permanent 400 (see the clients'
 * `isPermanent`).
 *
 * A caller whose turns are BATCHED must raise it (see {@link ChatSession}'s
 * `maxChars`): a turn is then a whole batch, and a cap sized for single units
 * would trip after two of them, leaving `maxTurns` with nothing to do.
 */
export const MAX_HISTORY_CHARS = 20_000;

export class ChatSession {
  /** Completed user/assistant pairs, oldest first. Never holds a partial turn. */
  private history: ChatMessage[] = [];

  /**
   * @param system  the system prompt, resent verbatim on every turn (and, being
   *                constant, the part the backend's prompt cache keys on).
   * @param maxTurns turns per conversation; 1 makes every request stateless,
   *                which is exactly the pre-session behaviour.
   * @param maxChars characters of history that also close a conversation, sized
   *                to the caller's turns — see {@link MAX_HISTORY_CHARS}.
   */
  constructor(
    private readonly client: ChatClient,
    private readonly system: string,
    private readonly maxTurns: number,
    private readonly maxChars: number = MAX_HISTORY_CHARS,
  ) {}

  /** Turns currently carried into the next request (0 right after a reset). */
  get turns(): number {
    return this.history.length / 2;
  }

  /**
   * Ask one turn. The reply joins the history — and so is shown to the model on
   * the next turn — unless the caller {@link rollback}s it. A thrown request
   * leaves the history untouched: nothing was answered, so there is nothing to
   * carry or to undo.
   */
  async ask(user: string, opts: ChatOptions = {}): Promise<string> {
    const messages: ChatMessage[] = [
      { role: "system", content: this.system },
      ...this.history,
      { role: "user", content: user },
    ];
    const reply = await this.client.chat(messages, opts);
    if (this.maxTurns > 1) {
      this.history.push({ role: "user", content: user }, { role: "assistant", content: reply });
      if (this.turns >= this.maxTurns || this.chars() > this.maxChars) this.history = [];
    }
    return reply;
  }

  /**
   * Drop the turn just added by {@link ask}. The caller uses this when the reply
   * turned out unusable (unparseable, or a rewrite QA rejected): the unit is
   * retried by a later run anyway, and keeping the exchange would leave a wrong
   * answer sitting in the conversation as a worked example.
   */
  rollback(): void {
    this.history.length = Math.max(0, this.history.length - 2);
  }

  private chars(): number {
    return this.history.reduce((n, m) => n + m.content.length, 0);
  }
}
