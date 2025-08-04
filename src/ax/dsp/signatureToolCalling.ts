import type { AxFunction } from '../ai/types.js';
import type { AxSignature } from './sig.js';
import { SignatureToolRouter } from './signatureToolRouter.js';

export interface SignatureToolCallingOptions {
  signatureToolCalling?: boolean;
  functions?: AxFunction[];
}

/**
 * Manages signature tool calling functionality
 */
export class SignatureToolCallingManager {
  private signatureToolCalling: boolean;
  private tools: AxFunction[];
  private router?: SignatureToolRouter;

  constructor(options: SignatureToolCallingOptions) {
    this.signatureToolCalling = options.signatureToolCalling ?? false;
    this.tools = options.functions ?? [];

    if (this.signatureToolCalling && this.tools.length > 0) {
      this.router = new SignatureToolRouter(this.tools);
    }
  }

  /**
   * Process signature for tool injection if signature tool calling is enabled
   */
  processSignature(signature: AxSignature): AxSignature {
    if (this.signatureToolCalling && this.tools.length > 0) {
      return signature.injectToolFields(this.tools);
    }
    return signature;
  }

  /**
   * Process results and execute tools if signature tool calling is enabled
   */
  async processResults(
    results: Record<string, unknown>,
    options?: { sessionId?: string; traceId?: string }
  ): Promise<Record<string, unknown>> {
    if (this.signatureToolCalling && this.router) {
      const processed = await this.router.route(results, options);
      return processed.remainingFields;
    }
    return results;
  }

  /**
   * Check if signature tool calling is enabled
   */
  isEnabled(): boolean {
    return this.signatureToolCalling;
  }

  /**
   * Get the tool router if available
   */
  getRouter(): SignatureToolRouter | undefined {
    return this.router;
  }
}
