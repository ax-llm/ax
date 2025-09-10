import type { AxFunction } from '../ai/types.js';
import type { AxChatResponseFunctionCall } from './functions.js';
import type { AxField, AxSignature } from './sig.js';
import { SignatureToolRouter } from './signatureToolRouter.js';
import { injectToolFields } from './sigTools.js';

export interface SignatureToolCallingOptions {
  functions?: AxFunction[];
}

/**
 * Manages signature tool calling functionality
 */
export class SignatureToolCallingManager {
  private tools: AxFunction[];
  private router: SignatureToolRouter;
  private injectedToolFieldNames: Set<string> = new Set();

  constructor(tools: AxFunction[]) {
    this.tools = tools;
    this.router = new SignatureToolRouter(tools);
  }

  /**
   * Get the current function call mode
   */
  // Mode is implicitly 'prompt' when this manager exists

  /**
   * Process signature for tool injection if prompt mode is enabled
   */
  processSignature(signature: AxSignature): AxSignature {
    const { signature: injected } = injectToolFields(this.tools, signature);

    // Track which fields were injected so extraction can treat them as optional if needed
    const injectedNames = new Set(
      injected.getOutputFields().map((f: AxField) => f.name) as string[]
    );
    const originalNames = new Set(
      signature.getOutputFields().map((f: AxField) => f.name) as string[]
    );
    this.injectedToolFieldNames = new Set(
      [...injectedNames].filter(
        (n: string) => !originalNames.has(n)
      ) as string[]
    );
    return injected;
  }

  /**
   * Process results and return function calls (no execution)
   */
  async processResults(
    results: Record<string, unknown>,
    options?: { sessionId?: string; traceId?: string }
  ): Promise<AxChatResponseFunctionCall[] | undefined> {
    const { functionCalls } = await this.router.route(results, options);
    return functionCalls.length > 0 ? functionCalls : undefined;
  }

  /**
   * Return names of fields injected for prompt-mode tools
   */
  getInjectedToolFieldNames(): string[] {
    return Array.from(this.injectedToolFieldNames);
  }

  /**
   * Get the tool router if available
   */
  getRouter(): SignatureToolRouter {
    return this.router;
  }
}
