import type { AxFunction } from '../ai/types.js';
import type { AxSignature } from './sig.js';
import { SignatureToolRouter } from './signatureToolRouter.js';

export interface SignatureToolCallingOptions {
  functionCallMode?: 'auto' | 'native' | 'prompt';
  functions?: AxFunction[];
}

/**
 * Manages signature tool calling functionality
 */
export class SignatureToolCallingManager {
  private functionCallMode: 'auto' | 'native' | 'prompt';
  private tools: AxFunction[];
  private router?: SignatureToolRouter;
  private usePromptMode: boolean = false;

  constructor(options: SignatureToolCallingOptions) {
    this.functionCallMode = options.functionCallMode ?? 'auto';
    this.tools = options.functions ?? [];

    // For now, we'll initialize based on the mode
    // In auto mode, we'll determine this later when we have AI instance
    if (this.functionCallMode === 'prompt' && this.tools.length > 0) {
      this.usePromptMode = true;
      this.router = new SignatureToolRouter(this.tools);
    }
  }

  /**
   * Set whether to use prompt mode based on AI capabilities
   */
  setUsePromptMode(usePrompt: boolean): void {
    this.usePromptMode = usePrompt;
    if (usePrompt && this.tools.length > 0 && !this.router) {
      this.router = new SignatureToolRouter(this.tools);
    }
  }

  /**
   * Get the current function call mode
   */
  getMode(): 'auto' | 'native' | 'prompt' {
    return this.functionCallMode;
  }

  /**
   * Process signature for tool injection if prompt mode is enabled
   */
  processSignature(signature: AxSignature): AxSignature {
    if (this.usePromptMode && this.tools.length > 0) {
      return signature.injectToolFields(this.tools);
    }
    return signature;
  }

  /**
   * Process results and execute tools if prompt mode is enabled
   */
  async processResults(
    results: Record<string, unknown>,
    options?: { sessionId?: string; traceId?: string }
  ): Promise<Record<string, unknown>> {
    if (this.usePromptMode && this.router) {
      const processed = await this.router.route(results, options);
      return processed.remainingFields;
    }
    return results;
  }

  /**
   * Check if prompt mode is enabled
   */
  isPromptModeEnabled(): boolean {
    return this.usePromptMode;
  }

  /**
   * Check if we should use native function calling
   */
  isNativeModeEnabled(): boolean {
    return !this.usePromptMode && this.tools.length > 0;
  }

  /**
   * Get the tool router if available
   */
  getRouter(): SignatureToolRouter | undefined {
    return this.router;
  }
}
