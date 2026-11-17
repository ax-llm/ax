/**
 * Recovery for an actor turn whose model reply could not be used because it was
 * cut off at the output limit.
 *
 * A reply that spends its whole output allowance (often on reasoning) arrives
 * either with no usable content — the generator reports "Max tokens reached
 * before completion" — or with a truncated tool-call payload that no longer
 * parses ("Invalid function arguments"). Nothing ran in the runtime, so asking
 * again is safe; without it one such reply ends the whole run.
 */

/** Extra model calls one actor turn may spend on an unusable reply. */
export const MAX_CUT_OFF_REPLY_RETRIES = 3;

/** Appended to the action log from the second retry on. */
export const CUT_OFF_REPLY_NOTE =
  '[NOTE: Your last reply could not be used: it was cut off at the output limit or was incomplete, so nothing ran. Think briefly and return a shorter, complete step now; continue the rest on later turns.]';

const CUT_OFF_REPLY_PATTERN =
  /Max tokens reached before completion|Invalid function arguments/;

/** True when a generation failed because the model reply was truncated. */
export function isCutOffReplyError(error: unknown): boolean {
  let current: unknown = error;
  // Generation errors wrap the original failure; inspect the short cause chain.
  for (let depth = 0; current !== undefined && depth < 6; depth++) {
    const message =
      current instanceof Error
        ? current.message
        : typeof current === 'string'
          ? current
          : '';
    if (CUT_OFF_REPLY_PATTERN.test(message)) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

/**
 * Runs one actor model call. When the reply is cut off, asks again: once
 * unchanged, then with a short note telling the model what happened. Any other
 * failure, and a reply that stays unusable after every retry, is rethrown.
 */
export async function forwardWithCutOffRetry<T>(
  forward: (actionLogText: string) => Promise<T>,
  actionLogText: string
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await forward(
        attempt >= 2
          ? `${actionLogText}\n\n${CUT_OFF_REPLY_NOTE}`
          : actionLogText
      );
    } catch (error) {
      if (attempt >= MAX_CUT_OFF_REPLY_RETRIES || !isCutOffReplyError(error)) {
        throw error;
      }
    }
  }
}
