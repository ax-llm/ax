import { createContext, runInContext } from 'node:vm';

import type { AxCodeInterpreter, AxCodeSession } from '@ax-llm/ax';

function raceAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      new Error(`Aborted: ${signal.reason ?? 'VM execution aborted'}`)
    );
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(new Error(`Aborted: ${signal.reason ?? 'VM execution aborted'}`));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      }
    );
  });
}

/**
 * Node.js JavaScript interpreter for RLM using `node:vm`.
 * Creates persistent sessions where variables survive across `execute()` calls.
 */
export class AxRLMJSInterpreter implements AxCodeInterpreter {
  readonly language = 'JavaScript';
  private readonly timeout: number;

  constructor(options?: Readonly<{ timeout?: number }>) {
    this.timeout = options?.timeout ?? 30_000;
  }

  createSession(globals?: Record<string, unknown>): AxCodeSession {
    const context = createContext({
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      ...globals,
    });
    const timeout = this.timeout;

    return {
      async execute(
        code: string,
        options?: { signal?: AbortSignal }
      ): Promise<unknown> {
        if (options?.signal?.aborted) {
          throw new Error(
            `Aborted: ${options.signal.reason ?? 'VM execution aborted'}`
          );
        }
        if (/\bawait\b/.test(code)) {
          // Wrap in async IIFE so top-level await works.
          // Only bare assignments (no var/const/let) persist across calls.
          const wrapped = `(async () => { ${code} })()`;
          const execPromise = runInContext(wrapped, context, { timeout });

          if (options?.signal) {
            return await raceAbortSignal(execPromise, options.signal);
          }
          return await execPromise;
        }
        // Direct execution: var declarations persist on the context,
        // and the last expression value is auto-returned.
        const result = runInContext(code, context, { timeout });
        if (options?.signal?.aborted) {
          throw new Error(
            `Aborted: ${options.signal.reason ?? 'VM execution aborted'}`
          );
        }
        return result;
      },
      close() {
        // No cleanup needed for vm contexts
      },
    };
  }
}

/**
 * Factory function for creating an AxRLMJSInterpreter.
 */
export function axCreateRLMJSInterpreter(
  options?: Readonly<{ timeout?: number }>
): AxRLMJSInterpreter {
  return new AxRLMJSInterpreter(options);
}
