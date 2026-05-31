// cspell:ignore Streamable

import type {
  JSONValue,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolCall,
  LanguageModelV3ToolChoice,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type {
  AxAgentic,
  AxAIService,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxFunction,
  AxFunctionJSONSchema,
  AxGenIn,
  AxGenOut,
  AxTokenUsage,
} from '@ax-llm/ax/index.js';
import type { ModelMessage } from 'ai';
import { customAlphabet } from 'nanoid';
import type { ReactNode } from 'react';
import { z } from 'zod';

type Writeable<T> = { -readonly [P in keyof T]: T[P] };
type AxChatRequestChatPrompt = Writeable<AxChatRequest['chatPrompt'][0]>;

type AxResponseLike = Pick<
  AxChatResponse,
  | 'sessionId'
  | 'remoteId'
  | 'remoteRequestId'
  | 'remoteSessionId'
  | 'providerMetadata'
  | 'modelUsage'
>;

function toJSONValue(value: unknown): JSONValue | undefined {
  if (value === null) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => toJSONValue(item))
      .filter((item): item is JSONValue => item !== undefined);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, nested]) => [key, toJSONValue(nested)] as const)
      .filter((entry): entry is readonly [string, JSONValue] => {
        return entry[1] !== undefined;
      });
    return Object.fromEntries(entries) as JSONValue;
  }
  return undefined;
}

function mergeProviderMetadata(
  base?: SharedV3ProviderMetadata,
  next?: SharedV3ProviderMetadata
): SharedV3ProviderMetadata | undefined {
  if (!base && !next) return undefined;
  const merged: SharedV3ProviderMetadata = {};
  for (const source of [base, next]) {
    if (!source) continue;
    for (const [provider, metadata] of Object.entries(source)) {
      merged[provider] = {
        ...(merged[provider] ?? {}),
        ...metadata,
      };
    }
  }
  return merged;
}

function createProviderMetadata(
  res: Readonly<AxResponseLike>,
  provider: string
): SharedV3ProviderMetadata | undefined {
  let metadata: SharedV3ProviderMetadata | undefined;

  if (res.providerMetadata) {
    metadata = {};
    for (const [providerName, providerMetadata] of Object.entries(
      res.providerMetadata
    )) {
      const jsonProviderMetadata = toJSONValue(providerMetadata);
      if (
        jsonProviderMetadata &&
        typeof jsonProviderMetadata === 'object' &&
        !Array.isArray(jsonProviderMetadata)
      ) {
        metadata[providerName] = jsonProviderMetadata;
      }
    }
  }

  const axMetadata = {
    ...(res.sessionId ? { sessionId: res.sessionId } : {}),
    ...(res.remoteRequestId ? { requestId: res.remoteRequestId } : {}),
    ...(res.remoteSessionId ? { remoteSessionId: res.remoteSessionId } : {}),
  };

  if (Object.keys(axMetadata).length > 0) {
    metadata = mergeProviderMetadata(metadata, {
      [provider]: axMetadata,
    });
  }

  return metadata;
}

function createResponseMetadata(res: Readonly<AxResponseLike>) {
  if (!res.remoteId && !res.modelUsage?.model) {
    return undefined;
  }
  return {
    ...(res.remoteId ? { id: res.remoteId } : {}),
    ...(res.modelUsage?.model ? { modelId: res.modelUsage.model } : {}),
  };
}

type AxConfig = {
  fetch?: typeof fetch;
};

type Streamable = ReactNode | Promise<ReactNode>;
type Renderer<T> = (
  args: T
) =>
  | Streamable
  | Generator<Streamable, Streamable, void>
  | AsyncGenerator<Streamable, Streamable, void>;

const nanoid = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  7
);

export class AxAgentProvider<IN extends AxGenIn, OUT extends AxGenOut> {
  private readonly config?: AxConfig;
  private readonly funcInfo: AxFunction;
  private generateFunction: Renderer<OUT>;
  private updateState: (msgs: readonly ModelMessage[]) => void;

  constructor({
    agent,
    updateState,
    generate,
    config,
  }: Readonly<{
    agent: AxAgentic<IN, OUT>;
    updateState: (msgs: readonly ModelMessage[]) => void;
    generate: Renderer<OUT>;
    config?: Readonly<AxConfig>;
  }>) {
    this.funcInfo = agent.getFunction();
    this.generateFunction = generate;
    this.updateState = updateState;
    this.config = config;
  }

  get description() {
    return this.funcInfo.description;
  }

  get parameters(): z.ZodTypeAny {
    const schema = this.funcInfo.parameters ?? {
      type: 'object',
      properties: {},
    };

    return convertToZodSchema(schema);
  }

  get generate(): Renderer<IN> {
    const fn = async (input: IN) => {
      const res = (await this.funcInfo.func(input)) as OUT;
      const toolCallId = nanoid();

      this.updateState([
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolName: this.funcInfo.name,
              toolCallId,
              input: input,
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolName: this.funcInfo.name,
              toolCallId,
              output: { type: 'text' as const, value: JSON.stringify(res) },
            },
          ],
        },
      ]);

      return this.generateFunction(res);
    };
    return fn as Renderer<IN>;
  }
}

export class AxAIProvider implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  private readonly ai: AxAIService;
  private readonly config?: AxConfig;

  public modelId: string;

  constructor(ai: AxAIService, config?: Readonly<AxConfig>) {
    this.ai = ai;
    this.config = config;
    this.modelId = this.ai.getName();
  }

  get provider(): string {
    return this.ai.getName();
  }

  async doGenerate(
    options: LanguageModelV3CallOptions
  ): Promise<Awaited<ReturnType<LanguageModelV3['doGenerate']>>> {
    const req = createChatRequest(options);
    const res = (await this.ai.chat(req, {
      stream: false,
    })) as AxChatResponse;
    const choice = res.results.at(0);

    if (!choice) {
      throw new Error('No choice returned');
    }

    const content: LanguageModelV3Content[] = [];

    if (choice.content) {
      content.push({ type: 'text', text: choice.content });
    }

    if (choice.functionCalls) {
      for (const tc of choice.functionCalls) {
        content.push({
          type: 'tool-call',
          toolCallId: tc.id,
          toolName: tc.function.name,
          input:
            typeof tc.function.params === 'string'
              ? tc.function.params
              : JSON.stringify(tc.function.params),
        });
      }
    }

    const providerMetadata = createProviderMetadata(res, this.provider);
    const response = createResponseMetadata(res);

    return {
      content,
      finishReason: mapAxFinishReason(choice.finishReason),
      usage: createUsage(res.modelUsage?.tokens),
      ...(providerMetadata ? { providerMetadata } : {}),
      ...(response ? { response } : {}),
      warnings: [] as SharedV3Warning[],
    };
  }

  async doStream(
    options: LanguageModelV3CallOptions
  ): Promise<Awaited<ReturnType<LanguageModelV3['doStream']>>> {
    const req = createChatRequest(options);

    const res = (await this.ai.chat(req, {
      stream: true,
    })) as ReadableStream<AxChatResponse>;

    return {
      stream: res.pipeThrough(new AxToSDKTransformer(this.provider)),
    };
  }
}

function prepareToolsAndToolChoice(
  tools: Array<LanguageModelV3FunctionTool>,
  toolChoice?: LanguageModelV3ToolChoice
): Pick<AxChatRequest, 'functions' | 'functionCall'> {
  // when the tools array is empty, change it to undefined to prevent errors:
  if (!tools || tools.length === 0) {
    return {};
  }
  const functions = tools.map((f) => ({
    name: f.name,
    description: f.description ?? '',
    parameters: f.inputSchema as AxFunctionJSONSchema,
  }));

  if (!toolChoice) {
    return { functions };
  }

  const type = toolChoice.type;

  switch (type) {
    case 'auto':
      return { functions, functionCall: 'auto' };
    case 'none':
      return { functions, functionCall: 'none' };
    case 'required':
      return { functions, functionCall: 'required' };
    case 'tool':
      return {
        functions,
        functionCall: {
          type: 'function',
          function: { name: toolChoice.toolName },
        },
      };
    default: {
      const ExhaustiveCheck: never = type;
      throw new Error(`Unsupported tool choice type: ${ExhaustiveCheck}`);
    }
  }
}

function convertToAxChatPrompt(
  prompt: Readonly<LanguageModelV3Prompt>
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
          content: content.map((part) => {
            switch (part.type) {
              case 'text': {
                return { type: 'text', text: part.text };
              }
              case 'file': {
                if (!part.mediaType) {
                  throw new Error('File part must have a mediaType');
                }
                let dataContent: string;
                if (typeof part.data === 'string') {
                  dataContent = part.data;
                } else if (part.data instanceof URL) {
                  dataContent = part.data.toString();
                } else {
                  dataContent = Buffer.from(part.data).toString('base64');
                }
                return {
                  type: 'image',
                  mimeType: part.mediaType,
                  image: dataContent,
                };
              }
              default:
                throw new Error(`Unsupported part: ${part}`);
              //   case 'audio': {
              //     if (!part.data) {
              //       throw new Error('Audio part must have a audio');
              //     }
              //     if (!ArrayBuffer.isView(part.data)) {
              //       throw new Error('Audio part must have an ArrayBuffer');
              //     }
              //     const data = Buffer.from(part.data).toString('base64');
              //     return {
              //       type: 'audio',
              //       format: 'wav',
              //       data
              //     };
              //   }
            }
          }),
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
                  params:
                    typeof part.input === 'string'
                      ? JSON.parse(part.input)
                      : part.input,
                },
              });
              break;
            }

            default: {
              const ExhaustiveCheck = part;
              throw new Error(`Unsupported part: ${ExhaustiveCheck}`);
            }
          }
        }

        const functionCalls = toolCalls.length === 0 ? undefined : toolCalls;

        if (functionCalls || text.length > 0) {
          messages.push({
            role: 'assistant',
            content: text,
            functionCalls,
          });
        }

        break;
      }
      case 'tool': {
        for (const part of content) {
          if (part.type !== 'tool-result') {
            throw new Error(`Unsupported part: ${part.type}`);
          }
          messages.push({
            role: 'function' as const,
            functionId: part.toolCallId,
            result:
              typeof part.output === 'object' && part.output?.type === 'text'
                ? part.output.value
                : JSON.stringify(part.output, null, 2),
          });
        }
        break;
      }
      default: {
        const ExhaustiveCheck: never = role;
        throw new Error(`Unsupported role: ${ExhaustiveCheck}`);
      }
    }
  }

  return messages;
}

function mapAxFinishReason(
  finishReason: AxChatResponseResult['finishReason']
): LanguageModelV3FinishReason {
  const raw = finishReason;
  switch (finishReason) {
    case 'stop':
      return { unified: 'stop', raw };
    case 'length':
      return { unified: 'length', raw };
    case 'function_call':
      return { unified: 'tool-calls', raw };
    case 'content_filter':
      return { unified: 'content-filter', raw };
    case 'error':
      return { unified: 'error', raw };
    default:
      return { unified: 'other', raw };
  }
}

function createChatRequest({
  tools,
  toolChoice,
  prompt,
  maxOutputTokens,
  temperature,
  topP,
  frequencyPenalty,
  presencePenalty,
  //seed,
}: Readonly<LanguageModelV3CallOptions>): AxChatRequest {
  const req: AxChatRequest = {
    chatPrompt: convertToAxChatPrompt(prompt),
    ...(frequencyPenalty != null ? { frequencyPenalty } : {}),
    ...(presencePenalty != null ? { presencePenalty } : {}),
    ...(maxOutputTokens != null ? { maxTokens: maxOutputTokens } : {}),
    ...(temperature != null ? { temperature } : {}),
    ...(topP != null ? { topP } : {}),
  };

  if (tools && tools.length > 0) {
    const functionTools = tools.filter(
      (tool): tool is LanguageModelV3FunctionTool => tool.type === 'function'
    );
    return { ...req, ...prepareToolsAndToolChoice(functionTools, toolChoice) };
  }

  return req;
}

function createUsage(tokens?: Readonly<AxTokenUsage>): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: tokens?.promptTokens,
      noCache: undefined,
      cacheRead: tokens?.cacheReadTokens,
      cacheWrite: tokens?.cacheCreationTokens,
    },
    outputTokens: {
      total: tokens?.completionTokens,
      text: undefined,
      reasoning: tokens?.reasoningTokens,
    },
  };
}

function addUsage(
  usage: Readonly<LanguageModelV3Usage>,
  tokens?: Readonly<AxTokenUsage>
): LanguageModelV3Usage {
  return {
    inputTokens: {
      ...usage.inputTokens,
      total: (usage.inputTokens.total ?? 0) + (tokens?.promptTokens ?? 0),
    },
    outputTokens: {
      ...usage.outputTokens,
      total: (usage.outputTokens.total ?? 0) + (tokens?.completionTokens ?? 0),
    },
  };
}

class AxToSDKTransformer extends TransformStream<
  AxChatResponse,
  LanguageModelV3StreamPart
> {
  private usage: LanguageModelV3Usage = {
    inputTokens: {
      total: 0,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 0,
      text: undefined,
      reasoning: undefined,
    },
  };

  private finishReason: LanguageModelV3FinishReason = {
    unified: 'other',
    raw: undefined,
  };

  private functionCalls: LanguageModelV3ToolCall[] = [];
  private providerMetadata: SharedV3ProviderMetadata | undefined;
  private responseMetadataSent = false;
  private hasStarted = false;
  private textStarted = false;

  constructor(provider: string) {
    const providerName = provider;
    const transformer = {
      transform: (
        chunk: Readonly<AxChatResponse>,
        controller: TransformStreamDefaultController<LanguageModelV3StreamPart>
      ) => {
        // Emit stream-start event only once
        if (!this.hasStarted) {
          controller.enqueue({
            type: 'stream-start',
            warnings: [] as SharedV3Warning[],
          });
          this.hasStarted = true;
        }

        const chunkProviderMetadata = createProviderMetadata(
          chunk,
          providerName
        );
        this.providerMetadata = mergeProviderMetadata(
          this.providerMetadata,
          chunkProviderMetadata
        );

        const responseMetadata = createResponseMetadata(chunk);
        if (!this.responseMetadataSent && responseMetadata) {
          controller.enqueue({
            type: 'response-metadata',
            ...responseMetadata,
          });
          this.responseMetadataSent = true;
        }

        const choice = chunk.results.at(0);
        if (!choice) {
          // End text if it was started
          if (this.textStarted) {
            controller.enqueue({
              type: 'text-end',
              id: 'text-content',
            });
          }

          const val = {
            type: 'finish' as const,
            finishReason: this.finishReason,
            usage: this.usage,
            ...(this.providerMetadata
              ? { providerMetadata: this.providerMetadata }
              : {}),
          };
          controller.enqueue(val);
          return;
        }

        if (chunk.modelUsage) {
          this.usage = addUsage(this.usage, chunk.modelUsage.tokens);
        }

        if (choice.functionCalls) {
          for (const fc of choice.functionCalls) {
            const index = this.functionCalls.findIndex(
              (f) => f.toolCallId === fc.id
            );
            if (index === -1) {
              this.functionCalls.push({
                type: 'tool-call' as const,
                toolCallId: fc.id,
                toolName: fc.function.name,
                input:
                  typeof fc.function.params === 'string'
                    ? fc.function.params
                    : JSON.stringify(fc.function.params),
              });
            } else {
              const obj = this.functionCalls[index];
              if (!obj) {
                continue;
              }
              if (typeof fc.function.params === 'string') {
                obj.input = ((obj.input as string) || '') + fc.function.params;
              } else {
                obj.input = JSON.stringify(fc.function.params);
              }
            }
            this.finishReason = { unified: 'tool-calls', raw: 'function_call' };
          }
        }

        if (choice.content && choice.content.length > 0) {
          // Start text stream if not started
          if (!this.textStarted) {
            controller.enqueue({
              type: 'text-start',
              id: 'text-content',
            });
            this.textStarted = true;
          }

          controller.enqueue({
            type: 'text-delta',
            id: 'text-content',
            delta: choice.content ?? '',
          });
          this.finishReason = mapAxFinishReason(choice.finishReason);
        }
      },
      flush: (
        controller: TransformStreamDefaultController<LanguageModelV3StreamPart>
      ) => {
        // End text stream if it was started
        if (this.textStarted) {
          controller.enqueue({
            type: 'text-end',
            id: 'text-content',
          });
        }

        for (const fc of this.functionCalls) {
          controller.enqueue(fc);
        }

        const val = {
          type: 'finish' as const,
          finishReason: this.finishReason,
          usage: this.usage,
          ...(this.providerMetadata
            ? { providerMetadata: this.providerMetadata }
            : {}),
        };
        controller.enqueue(val);
        controller.terminate();
      },
    };

    super(transformer);
  }
}

type AnyZod =
  | z.AnyZodObject
  | z.ZodString
  | z.ZodNumber
  | z.ZodBoolean
  | z.ZodArray<AnyZod>
  | z.ZodOptional<AnyZod>;

function convertToZodSchema(
  jsonSchema: Readonly<AxFunctionJSONSchema>
): AnyZod {
  const { type, properties, required, items } = jsonSchema;

  switch (type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      if (!items) {
        throw new Error("Array type must have 'items' property.");
      }
      return z.array(convertToZodSchema(items));
    case 'object': {
      if (!properties) {
        throw new Error("Object type must have 'properties' property.");
      }
      const shape: Record<string, AnyZod> = {};

      for (const [key, value] of Object.entries(properties)) {
        const schema = convertToZodSchema(value);
        let val = required?.includes(key) ? schema : schema.optional();
        val = value.description ? val.describe(value.description) : val;
        shape[key] = val;
      }
      return z.object(shape);
    }
    default:
      throw new Error(`Unsupported type: ${type}`);
  }
}
