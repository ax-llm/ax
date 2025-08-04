import type { AxFunction, AxFunctionHandler } from '../ai/types.js';

export interface SignatureToolRouterResult {
  toolResults: Record<string, unknown>;
  remainingFields: Record<string, unknown>;
}

/**
 * Routes LLM output to tools based on populated optional fields
 */
export class SignatureToolRouter {
  private tools: Map<string, AxFunction>;
  private logger?: ((message: string) => void) | undefined;

  constructor(
    tools: AxFunction[],
    logger?: ((message: string) => void) | undefined
  ) {
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
    this.logger = logger;
  }

  /**
   * Process results and execute tools for populated fields
   */
  async route(
    results: Record<string, unknown>,
    options?: { sessionId?: string; traceId?: string }
  ): Promise<SignatureToolRouterResult> {
    const toolResults: Record<string, unknown> = {};
    const remainingFields: Record<string, unknown> = {};
    const executedTools: string[] = [];

    // Separate tool fields from regular fields
    for (const [key, value] of Object.entries(results)) {
      const tool = this.tools.get(this.normalizeToolName(key));

      if (tool && value !== undefined && value !== null) {
        // This is a tool field that should be executed
        try {
          // Logger removed for simplicity

          const toolResult = await this.executeTool(tool, value, options);
          toolResults[key] = toolResult;
          executedTools.push(tool.name);

          // Logger removed for simplicity
        } catch (_error) {
          // Logger removed for simplicity
          // Keep the original value if tool execution fails
          remainingFields[key] = value;
        }
      } else {
        // This is a regular field, keep it as-is
        remainingFields[key] = value;
      }
    }

    // Merge tool results back into remaining fields
    const finalResults = {
      ...remainingFields,
      ...toolResults,
    };

    return {
      toolResults,
      remainingFields: finalResults,
    };
  }

  /**
   * Execute a single tool with given arguments
   */
  private async executeTool<T = unknown>(
    tool: AxFunction,
    args: T,
    options?: { sessionId?: string; traceId?: string }
  ): Promise<unknown> {
    if (!tool.func) {
      throw new Error(`Tool ${tool.name} has no handler function`);
    }

    // Ensure args is an object for tools with parameters
    const toolArgs = typeof args === 'object' && args !== null ? args : {};

    // Execute the tool
    const handler = tool.func as AxFunctionHandler;
    const result = await handler(toolArgs, {
      sessionId: options?.sessionId,
      traceId: options?.traceId,
    });

    return result;
  }

  /**
   * Normalize tool name to match field names
   */
  private normalizeToolName(fieldName: string): string {
    // Convert snake_case back to camelCase for tool matching
    return fieldName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  /**
   * Check if a field name corresponds to a tool
   */
  isToolField(fieldName: string): boolean {
    return this.tools.has(this.normalizeToolName(fieldName));
  }

  /**
   * Get all tool field names
   */
  getToolFieldNames(): string[] {
    return Array.from(this.tools.keys()).map((name) =>
      name
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, '')
    );
  }
}
