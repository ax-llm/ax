import { createContext, runInContext } from 'node:vm';

import type { AxCodeInterpreter, AxCodeSession } from '@ax-llm/ax';

/**
 * Node.js JavaScript interpreter for RLM using `node:vm`.
 * Creates persistent sessions where variables survive across `execute()` calls.
 */
export class AxRLMJSInterpreter implements AxCodeInterpreter {
  readonly language = 'JavaScript';

  createSession(globals?: Record<string, unknown>): AxCodeSession {
    const context = createContext({
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      ...globals,
    });

    return {
      async execute(code: string): Promise<unknown> {
        if (/\bawait\b/.test(code)) {
          // Wrap in async IIFE so top-level await works.
          // Only bare assignments (no var/const/let) persist across calls.
          const wrapped = `(async () => { ${code} })()`;
          return await runInContext(wrapped, context, { timeout: 30_000 });
        }
        // Direct execution: var declarations persist on the context,
        // and the last expression value is auto-returned.
        return runInContext(code, context, { timeout: 30_000 });
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
export function axCreateRLMJSInterpreter(): AxRLMJSInterpreter {
  return new AxRLMJSInterpreter();
}
