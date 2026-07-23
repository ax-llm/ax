import { axGlobals } from '../dsp/globals.js';
import type {
  AxChatResponse,
  AxEmbedResponse,
  AxTokenUsage,
  AxUsageContext,
  AxUsageEvent,
} from './types.js';

export function axMergeUsageContexts(
  defaults?: Readonly<AxUsageContext>,
  overrides?: Readonly<AxUsageContext>
): AxUsageContext | undefined {
  if (!defaults && !overrides) {
    return undefined;
  }

  const attributes =
    defaults?.attributes || overrides?.attributes
      ? {
          ...defaults?.attributes,
          ...overrides?.attributes,
        }
      : undefined;

  return {
    ...defaults,
    ...overrides,
    ...(attributes ? { attributes } : {}),
  };
}

function freezeUsageEvent(event: AxUsageEvent): Readonly<AxUsageEvent> {
  const tokens = Object.freeze({ ...event.tokens }) as AxTokenUsage;
  const context = event.context
    ? Object.freeze({
        ...event.context,
        ...(event.context.attributes
          ? { attributes: Object.freeze({ ...event.context.attributes }) }
          : {}),
      })
    : undefined;

  return Object.freeze({
    ...event,
    tokens,
    ...(context ? { context } : {}),
  });
}

export function axEmitUsageEvent(
  operation: AxUsageEvent['operation'],
  response: Readonly<AxChatResponse | AxEmbedResponse>,
  context: Readonly<AxUsageContext> | undefined,
  streaming: boolean
): void {
  const usage = response.modelUsage;
  if (!usage?.tokens) {
    return;
  }

  const observer = axGlobals.onUsage;
  if (!observer) {
    return;
  }

  const event = freezeUsageEvent({
    operation,
    ai: usage.ai,
    model: usage.model,
    tokens: usage.tokens,
    ...(context ? { context: { ...context } } : {}),
    ...(response.sessionId ? { sessionId: response.sessionId } : {}),
    ...(response.remoteId ? { remoteId: response.remoteId } : {}),
    ...(response.remoteRequestId
      ? { remoteRequestId: response.remoteRequestId }
      : {}),
    ...(response.remoteSessionId
      ? { remoteSessionId: response.remoteSessionId }
      : {}),
    streaming,
  });

  try {
    const result = observer(event);
    if (result && typeof result.then === 'function') {
      void Promise.resolve(result).catch(() => {});
    }
  } catch {}
}
