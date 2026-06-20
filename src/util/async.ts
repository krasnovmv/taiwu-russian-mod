/** Async helpers shared by the network engines. */

/** Resolve after `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff delay for a retry attempt (0-based). */
export function backoffMs(attempt: number, baseMs = 500): number {
  return baseMs * 2 ** attempt;
}
