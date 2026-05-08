import type { AxChatLogEntry } from '../../dsp/types.js';
import type { AxAgentGuidancePayload } from '../completion.js';
import type { AxAgentGuidanceLogEntry } from './types.js';

/**
 * Append a guidance entry, collapsing consecutive duplicates.
 *
 * If the most recent entry has the same `triggeredBy` and `guidance`, refresh
 * its `turn` instead of pushing a new copy. Prevents the Guidance Log from
 * filling with N identical "runtime policy" nags when the actor repeats the
 * same violation across turns.
 */
export function appendGuidanceEntry(
  entries: AxAgentGuidanceLogEntry[],
  entry: AxAgentGuidanceLogEntry
): void {
  const last = entries[entries.length - 1];
  if (
    last &&
    last.triggeredBy === entry.triggeredBy &&
    last.guidance === entry.guidance
  ) {
    last.turn = entry.turn;
    return;
  }
  entries.push(entry);
}

/**
 * Extract plain {role, content} messages from the actor's chat log,
 * skipping tool-result entries that can't be serialized cleanly.
 */
export function snapshotChatLogMessages(
  chatLog: readonly AxChatLogEntry[]
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  for (const entry of chatLog) {
    for (const msg of entry.messages) {
      if (msg.role === 'tool') continue;
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  return messages;
}

export function renderGuidanceLog(
  entries: readonly AxAgentGuidanceLogEntry[]
): string | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  return entries
    .map(
      (entry) =>
        `- ${entry.triggeredBy ?? '(unknown function)'}, ${entry.guidance.replace(/\s+/g, ' ').trim()}`
    )
    .join('\n');
}

export function buildGuidanceActionLogOutput(
  payload: Readonly<AxAgentGuidancePayload>
): string {
  const functionName = payload.triggeredBy ?? '(unknown function)';
  return `Execution stopped at \`${functionName}\`. Guidance recorded in \`guidanceLog\`.`;
}

export function buildGuidanceActionLogCode(
  payload: Readonly<AxAgentGuidancePayload>
): string {
  const functionName = payload.triggeredBy ?? '(unknown function)';
  return `await ${functionName}(...)`;
}
