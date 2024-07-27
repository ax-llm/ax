import {
  type ReadableStream,
  TransformStream,
  TransformStreamDefaultController
} from 'stream/web';

import {
  type LanguageModelV1,
  type LanguageModelV1CallWarning,
  type LanguageModelV1FinishReason,
  type LanguageModelV1Prompt,
  type LanguageModelV1StreamPart,
  UnsupportedFunctionalityError
} from '@ai-sdk/provider';
import type {
  AxAgent,
  AxAIService,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxFunction,
  AxFunctionJSONSchema,
  AxGenIn,
  AxGenOut
} from '@ax-llm/ax/index.js';

type Writeable<T> = { -readonly [P in keyof T]: T[P] };
type AxChatRequestChatPrompt = Writeable<AxChatRequest['chatPrompt'][0]>;

type AxConfig = {
  fetch?: typeof fetch;
};

type generateFunction<T> = ((input: T) => Promise<unknown>) | undefined;

const schemaSymbol = Symbol('vercel.ai.schema');

interface RenderTool<IN> {
  description?: string;
  parameters?: {
    [schemaSymbol]: true;
    validate: undefined;
    jsonSchema: AxFunctionJSONSchema;
  };
  generate?: generateFunction<IN>;
}

export class AxAgentProvider<IN extends AxGenIn, OUT extends AxGenOut>
  implements RenderTool<IN>
{
  private readonly config?: AxConfig;
  private readonly funcInfo: AxFunction;
  private generateFunction: generateFunction<OUT>;

  constructor(
    agent: Readonly<AxAgent<IN, AxGenOut>>,
    generate: generateFunction<OUT>,
    config?: Readonly<AxConfig>
  ) {
    this.config = config;
    this.funcInfo = agent.getFunction();
    this.generateFunction = generate;
  }

  get description() {
    return this.funcInfo.description;
  }

  get parameters() {
    const jsonSchema = this.funcInfo.parameters ?? {
      type: 'object',
      properties: {}
    };

    return {
      [schemaSymbol]: true as const,
      validate: undefined,
      jsonSchema
    };
  }

  get generate(): generateFunction<IN> {
    if (!this.funcInfo.func) {
      return undefined;
    }
    const agentFunc = this.funcInfo.func;

    return async (input: IN): Promise<unknown> => {
      const res = (await agentFunc(input)) as OUT;
      if (this.generateFunction) {
        return await this.generateFunction(res);
      }
    };
  }
}

export class AxAIProvider implements LanguageModelV1 {
  readonly specificationVersion = 'v1';
  readonly defaultObjectGenerationMode = 'json';

  private readonly ai: AxAIService;
  private readonly config?: AxConfig;

  public modelId: string;

  constructor(ai: AxAIService, config?: Readonly<AxConfig>) {
    this.ai = ai;
    this.config = config;
    this.modelId = this.ai.getModelInfo().name;
  }

  get provider(): string {
    return this.ai.getName();
  }

  async doGenerate(
    options: Readonly<Parameters<LanguageModelV1['doGenerate']>[0]>
  ): Promise<Awaited<ReturnType<LanguageModelV1['doGenerate']>>> {
    const { req, warnings } = createChatRequest(options);
    const res = (await this.ai.chat(req)) as AxChatResponse;
    const choice = res.results.at(0);

    if (!choice) {
      throw new Error('No choice returned');
    }

    return {
      text: choice.content ?? undefined,
      toolCalls: choice.functionCalls?.map((tc) => ({
        toolCallType: 'function',
        toolCallId: tc.id,
        toolName: tc.function.name,
        args: JSON.stringify(tc.function.params!)
      })),
      finishReason: mapAxFinishReason(choice.finishReason),
      usage: {
        promptTokens: res.modelUsage?.promptTokens ?? 0,
        completionTokens: res.modelUsage?.completionTokens ?? 0
      },
      rawCall: { rawPrompt: '', rawSettings: req.modelConfig ?? {} },
      warnings
    };
  }

  async doStream(
    options: Readonly<Parameters<LanguageModelV1['doStream']>[0]>
  ): Promise<Awaited<ReturnType<LanguageModelV1['doStream']>>> {
    const { req, warnings } = createChatRequest(options);

    const res = (await this.ai.chat(req, {
      stream: true
    })) as ReadableStream<AxChatResponse>;

    return {
      stream: res.pipeThrough(new AxToSDKTransformer()),
      rawCall: { rawPrompt: '', rawSettings: req.modelConfig ?? {} },
      warnings
    };
  }
}

function prepareToolsAndToolChoice(
  mode: Readonly<
    Parameters<LanguageModelV1['doGenerate']>[0]['mode'] & { type: 'regular' }
  >
) {
  // when the tools array is empty, change it to undefined to prevent errors:
  const tools = mode.tools?.length ? mode.tools : undefined;

  if (tools == null) {
    return { tools: undefined, tool_choice: undefined };
  }

  const mappedTools = tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));

  const toolChoice = mode.toolChoice;

  if (toolChoice == null) {
    return { tools: mappedTools, tool_choice: undefined };
  }

  const type = toolChoice.type;

  switch (type) {
    case 'auto':
    case 'none':
      return { tools: mappedTools, tool_choice: type };
    case 'required':
      return { tools: mappedTools, tool_choice: 'any' };

    // mistral does not support tool mode directly,
    // so we filter the tools and force the tool choice through 'any'
    case 'tool':
      return {
        tools: mappedTools.filter(
          (tool) => tool.function.name === toolChoice.toolName
        ),
        tool_choice: 'any'
      };
    default: {
      const _exhaustiveCheck: never = type;
      throw new Error(`Unsupported tool choice type: ${_exhaustiveCheck}`);
    }
  }
}

function convertToAxChatPrompt(
  prompt: Readonly<LanguageModelV1Prompt>
): AxChatRequest['chatPrompt'] {
  const messages: AxChatRequest['chatPrompt'] = [];

  for (const { role, content } of prompt) {
    switch (role) {
      case 'system': {
        messages.push({ role: 'system', content });
        break;
      }

      case 'user': {
        messages.push({
          role: 'user',
          content: content
            .map((part) => {
              switch (part.type) {
                case 'text': {
                  return part.text;
                }
                case 'image': {
                  throw new UnsupportedFunctionalityError({
                    functionality: 'image-part'
                  });
                }
              }
            })
            .join('')
        });
        break;
      }

      case 'assistant': {
        let text = '';
        const toolCalls: Extract<
          AxChatRequestChatPrompt,
          { role: 'assistant' }
        >['functionCalls'] = [];

        for (const part of content) {
          switch (part.type) {
            case 'text': {
              text += part.text;
              break;
            }
            case 'tool-call': {
              toolCalls.push({
                id: part.toolCallId,
                type: 'function',
                function: {
                  name: part.toolName,
                  params: part.args as Record<string, unknown>
                }
              });
              break;
            }
            default: {
              const _exhaustiveCheck: never = part;
              throw new Error(`Unsupported part: ${_exhaustiveCheck}`);
            }
          }
        }

        const functionCalls = toolCalls.length === 0 ? undefined : toolCalls;

        if (functionCalls || text.length > 0) {
          messages.push({
            role: 'assistant',
            content: text,
            functionCalls
          });
        }

        break;
      }
      case 'tool': {
        for (const toolResponse of content) {
          messages.push({
            role: 'assistant',
            name: toolResponse.toolName,
            content: JSON.stringify(toolResponse.result)
          });
        }
        break;
      }
      default: {
        const _exhaustiveCheck: never = role;
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`);
      }
    }
  }

  return messages;
}

export function mapAxFinishReason(
  finishReason: AxChatResponseResult['finishReason']
): LanguageModelV1FinishReason {
  switch (finishReason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'function_call':
      return 'tool-calls';
    default:
      return 'other';
  }
}

function createChatRequest({
  mode,
  prompt,
  maxTokens,
  temperature,
  topP,
  frequencyPenalty,
  presencePenalty
  //seed
}: Readonly<Parameters<LanguageModelV1['doGenerate']>[0]>): {
  req: AxChatRequest;
  warnings: LanguageModelV1CallWarning[];
} {
  const req: AxChatRequest = {
    chatPrompt: convertToAxChatPrompt(prompt),
    ...(frequencyPenalty != null ? { frequencyPenalty } : {}),
    ...(presencePenalty != null ? { presencePenalty } : {}),
    ...(maxTokens != null ? { maxTokens } : {}),
    ...(temperature != null ? { temperature } : {}),
    ...(topP != null ? { topP } : {})
  };

  const warnings: LanguageModelV1CallWarning[] = [];

  switch (mode.type) {
    case 'regular': {
      return {
        req: { ...req, ...prepareToolsAndToolChoice(mode) },
        warnings
      };
    }

    case 'object-json': {
      return {
        req,
        warnings
      };
    }

    case 'object-tool': {
      return {
        req: { ...req, ...mode.tool },
        warnings
      };
    }

    case 'object-grammar': {
      throw new UnsupportedFunctionalityError({
        functionality: 'object-grammar mode'
      });
    }

    default: {
      throw new Error(`Unsupported type`);
    }
  }
}

class AxToSDKTransformer extends TransformStream<
  AxChatResponse,
  LanguageModelV1StreamPart
> {
  private usage: Extract<
    LanguageModelV1StreamPart,
    { type: 'finish' }
  >['usage'] = {
    promptTokens: 0,
    completionTokens: 0
  };

  private finishReason: Extract<
    LanguageModelV1StreamPart,
    { type: 'finish' }
  >['finishReason'] = 'other';
  constructor() {
    const transformer = {
      transform: (
        chunk: Readonly<AxChatResponse>,
        controller: TransformStreamDefaultController<LanguageModelV1StreamPart>
      ) => {
        const choice = chunk.results.at(0);
        if (!choice) {
          return;
        }

        if (choice.functionCalls) {
          for (const tc of choice.functionCalls) {
            controller.enqueue({
              type: 'tool-call',
              toolCallType: 'function',
              toolCallId: tc.id,
              toolName: tc.function.name,
              args: JSON.stringify(tc.function.params)
            });
            this.finishReason = 'tool-calls';
          }
        }

        if (choice.content && choice.content.length > 0) {
          controller.enqueue({
            type: 'text-delta',
            textDelta: choice.content ?? ''
          });
        }
        this.finishReason = mapAxFinishReason(choice.finishReason);
      },
      flush: (
        controller: TransformStreamDefaultController<LanguageModelV1StreamPart>
      ) => {
        controller.enqueue({
          type: 'finish',
          finishReason: this.finishReason,
          usage: this.usage
        });
      }
    };

    super(transformer);

    this.usage = {
      promptTokens: 0,
      completionTokens: 0
    };
    this.finishReason = 'other';
  }
}
