import type {
  AxAIService,
  AxChatRequest,
  AxChatResponse,
  AxFunction,
} from '../ai/types.js';
import { parseFunctions } from '../dsp/functions.js';
import { axGlobals } from '../dsp/globals.js';
import type { AxProgramForwardOptions } from '../dsp/types.js';
import { axResolveMCPExecutionContext } from './execution.js';

export interface AxMCPChatResult {
  response: AxChatResponse;
  messages: AxChatRequest['chatPrompt'];
}

export type AxMCPChatOptions = AxProgramForwardOptions<string> & {
  maxSteps?: number;
};

function normalizeToolName(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function findBinding(
  functions: readonly AxFunction[],
  name: string
): AxFunction | undefined {
  return (
    functions.find((binding) => binding.name === name) ??
    functions.find(
      (binding) => normalizeToolName(binding.name) === normalizeToolName(name)
    )
  );
}

/** High-level chat loop with native MCP/UCP tool dispatch and retained history. */
export async function axMCPChat(
  ai: Readonly<AxAIService>,
  request: Readonly<AxChatRequest>,
  options: Readonly<AxMCPChatOptions> = {}
): Promise<AxMCPChatResult> {
  const context = await axResolveMCPExecutionContext(options);
  const inlineFunctions = options.functions
    ? parseFunctions(options.functions)
    : [];
  let functions = [...inlineFunctions, ...(context?.getToolBindings() ?? [])];
  let catalogRevision = context?.getCatalogRevision();
  const resolvedContext = context
    ? await context.resolveContextPrompt(options.mcpContext)
    : [];
  const systemPrefixLength = request.chatPrompt.findIndex(
    (message) => message.role !== 'system'
  );
  const splitAt =
    systemPrefixLength === -1 ? request.chatPrompt.length : systemPrefixLength;
  const messages: AxChatRequest['chatPrompt'] = [
    ...request.chatPrompt.slice(0, splitAt),
    ...resolvedContext,
    ...request.chatPrompt.slice(splitAt),
  ];
  const maxSteps = options.maxSteps ?? 10;

  for (let step = 0; step < maxSteps; step++) {
    const nextRevision = context?.getCatalogRevision();
    if (nextRevision !== catalogRevision) {
      functions = [...inlineFunctions, ...(context?.getToolBindings() ?? [])];
      catalogRevision = nextRevision;
    }
    const response = await ai.chat(
      {
        ...request,
        chatPrompt: messages,
        functions: [
          ...(request.functions ?? []),
          ...functions.map((binding) => ({
            name: binding.name,
            description: binding.description,
            parameters: binding.parameters,
          })),
        ],
      },
      { ...options, stream: false }
    );
    if (response instanceof ReadableStream) {
      throw new Error('MCP high-level chat requires a non-streaming response');
    }
    const calls = response.results.flatMap((result) =>
      (result.functionCalls ?? []).map((call) => ({ result, call }))
    );
    for (const result of response.results) {
      if (
        result.content !== undefined ||
        result.functionCalls?.length ||
        result.thought ||
        result.thoughtBlocks?.length
      ) {
        messages.push({
          role: 'assistant',
          content: result.content,
          name: result.name,
          functionCalls: result.functionCalls,
          thought: result.thought,
          thoughtBlocks: result.thoughtBlocks,
        });
      }
    }
    if (calls.length === 0) return { response, messages };
    const toolResults = await Promise.all(
      calls.map(async ({ call }) => {
        const binding = findBinding(functions, call.function.name);
        if (!binding) {
          throw new Error(`MCP chat tool not found: ${call.function.name}`);
        }
        const args =
          typeof call.function.params === 'string'
            ? JSON.parse(call.function.params || '{}')
            : (call.function.params ?? {});
        const raw = await binding.func(args, {
          ai,
          abortSignal: options.abortSignal,
          _mcpExecutionContext: context,
        });
        return {
          role: 'function',
          functionId: call.id,
          result: axGlobals.functionResultFormatter(raw),
          ...(binding.protocol
            ? { protocolResult: { protocol: binding.protocol, value: raw } }
            : {}),
        } as const;
      })
    );
    messages.push(...toolResults);
  }
  throw new Error(`MCP high-level chat exceeded ${maxSteps} model steps`);
}
