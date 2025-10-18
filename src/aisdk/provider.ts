// cspell:ignore Streamable

import {
  type ReadableStream,
  TransformStream,
  type TransformStreamDefaultController,
} from 'node:stream/web';
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2FinishReason,
  LanguageModelV2FunctionTool,
  LanguageModelV2ToolCall,
  LanguageModelV2Prompt,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  LanguageModelV2Content,
  LanguageModelV2ToolChoice,
  LanguageModelV2CallWarning,
} from '@ai-sdk/provider';
import type {
  AxAIService,
  AxAgentic,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxFunction,
  AxFunctionJSONSchema,
  AxGenIn,
  AxGenOut,
} from '@ax-llm/ax/index.js';
import type { CoreMessage } from 'ai';
import { customAlphabet } from 'nanoid';
import type { ReactNode } from 'react';
import { z } from 'zod';

type Writeable<T> = { -readonly [P in keyof T]: T[P] };
type AxChatRequestChatPrompt = Writeable<AxChatRequest['chatPrompt'][0]>;

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
  private updateState: (msgs: readonly CoreMessage[]) => void;

  constructor({
    agent,
    updateState,
    generate,
    config,
  }: Readonly<{
    agent: AxAgentic<IN, OUT>;
    updateState: (msgs: readonly CoreMessage[]) => void;
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

export class AxAIProvider implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const;
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
    options: LanguageModelV2CallOptions
  ): Promise<Awaited<ReturnType<LanguageModelV2['doGenerate']>>> {
    const req = createChatRequest(options);
    const res = (await this.ai.chat(req)) as AxChatResponse;
    const choice = res.results.at(0);

    if (!choice) {
      throw new Error('No choice returned');
    }

    const content: LanguageModelV2Content[] = [];

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

    return {
      content,
      finishReason: mapAxFinishReason(choice.finishReason),
      usage: {
        inputTokens: res.modelUsage?.tokens?.promptTokens ?? 0,
        outputTokens: res.modelUsage?.tokens?.completionTokens ?? 0,
        totalTokens:
          (res.modelUsage?.tokens?.promptTokens ?? 0) +
          (res.modelUsage?.tokens?.completionTokens ?? 0),
      },
      warnings: [] as LanguageModelV2CallWarning[],
    };
  }

  async doStream(
    options: LanguageModelV2CallOptions
  ): Promise<Awaited<ReturnType<LanguageModelV2['doStream']>>> {
    const req = createChatRequest(options);

    const res = (await this.ai.chat(req, {
      stream: true,
    })) as ReadableStream<AxChatResponse>;

    return {
      stream: res.pipeThrough(new AxToSDKTransformer()) as any,
    };
  }
}

function prepareToolsAndToolChoice(
  tools: Array<LanguageModelV2FunctionTool>,
  toolChoice?: LanguageModelV2ToolChoice
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
  prompt: Readonly<LanguageModelV2Prompt>
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
): LanguageModelV2FinishReason {
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
  tools,
  toolChoice,
  prompt,
  maxOutputTokens,
  temperature,
  topP,
  frequencyPenalty,
  presencePenalty,
  //seed,
}: Readonly<LanguageModelV2CallOptions>): AxChatRequest {
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
      (tool): tool is LanguageModelV2FunctionTool => tool.type === 'function'
    );
    return { ...req, ...prepareToolsAndToolChoice(functionTools, toolChoice) };
  }

  return req;
}

class AxToSDKTransformer extends TransformStream<
  AxChatResponse,
  LanguageModelV2StreamPart
> {
  private usage: LanguageModelV2Usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  private finishReason: LanguageModelV2FinishReason = 'other';

  private functionCalls: LanguageModelV2ToolCall[] = [];
  private hasStarted = false;
  private textStarted = false;

  constructor() {
    const transformer = {
      transform: (
        chunk: Readonly<AxChatResponse>,
        controller: TransformStreamDefaultController<LanguageModelV2StreamPart>
      ) => {
        // Emit stream-start event only once
        if (!this.hasStarted) {
          controller.enqueue({
            type: 'stream-start',
            warnings: [] as LanguageModelV2CallWarning[],
          });
          this.hasStarted = true;
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
          };
          controller.enqueue(val);
          return;
        }

        if (chunk.modelUsage) {
          this.usage = {
            inputTokens:
              (this.usage.inputTokens ?? 0) +
              (chunk.modelUsage?.tokens?.promptTokens ?? 0),
            outputTokens:
              (this.usage.outputTokens ?? 0) +
              (chunk.modelUsage.tokens?.completionTokens ?? 0),
            totalTokens:
              (this.usage.totalTokens ?? 0) +
              (chunk.modelUsage?.tokens?.promptTokens ?? 0) +
              (chunk.modelUsage.tokens?.completionTokens ?? 0),
          };
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
            this.finishReason = 'tool-calls';
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
        controller: TransformStreamDefaultController<LanguageModelV2StreamPart>
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
        };
        controller.enqueue(val);
        controller.terminate();
      },
    };

    super(transformer);
  }
}

type AnyZod = z.ZodTypeAny;

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
