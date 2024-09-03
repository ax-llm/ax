import { TransformStream, TransformStreamDefaultController } from 'stream/web';
import { UnsupportedFunctionalityError } from '@ai-sdk/provider';
import { z } from 'zod';
import { convertToZodSchema } from './util.js';

export class AxAgentProvider {
    config;
    funcInfo;
    generateFunction;
    constructor(agent, generate, config) {
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
        return convertToZodSchema(jsonSchema);
    }
    get generate() {
        if (!this.funcInfo.func) {
            return undefined;
        }
        const agentFunc = this.funcInfo.func;
        return async (input) => {
            const res = (await agentFunc(input));
            if (this.generateFunction) {
                return await this.generateFunction(res);
            }
        };
    }
}
export class AxAIProvider {
    specificationVersion = 'v1';
    defaultObjectGenerationMode = 'json';
    ai;
    config;
    modelId;
    constructor(ai, config) {
        this.ai = ai;
        this.config = config;
        this.modelId = this.ai.getModelInfo().name;
    }
    get provider() {
        return this.ai.getName();
    }
    async doGenerate(options) {
        const { req, warnings } = createChatRequest(options);
        const res = (await this.ai.chat(req));
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
                args: JSON.stringify(tc.function.params)
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
    async doStream(options) {
        const { req, warnings } = createChatRequest(options);

        const res = (await this.ai.chat(req, {
            stream: true
        }));

        return {
            stream: res.pipeThrough(new AxToSDKTransformer()),
            rawCall: { rawPrompt: '', rawSettings: req.modelConfig ?? {} },
            warnings
        };
    }
}
function prepareToolsAndToolChoice(mode) {
    // when the tools array is empty, change it to undefined to prevent errors:
    const functions = mode.tools?.length ? mode.tools : undefined;
    if (functions == null) {
        return { functions: undefined, tool_choice: undefined };
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
                tools: mappedTools.filter((tool) => tool.function.name === toolChoice.toolName),
                tool_choice: 'any'
            };
        default: {
            const _exhaustiveCheck = type;
            throw new Error(`Unsupported tool choice type: ${_exhaustiveCheck}`);
        }
    }
}
function convertToAxChatPrompt(prompt) {
    const messages = [];
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
                const toolCalls = [];
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
                                    params: part.args
                                }
                            });
                            break;
                        }
                        default: {
                            const _exhaustiveCheck = part;
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
                const _exhaustiveCheck = role;
                throw new Error(`Unsupported role: ${_exhaustiveCheck}`);
            }
        }
    }
    return messages;
}
export function mapAxFinishReason(finishReason) {
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
function createChatRequest({ mode, prompt, maxTokens, temperature, topP, frequencyPenalty, presencePenalty
//seed
 }) {
    const req = {
        chatPrompt: convertToAxChatPrompt(prompt),
        ...(frequencyPenalty != null ? { frequencyPenalty } : {}),
        ...(presencePenalty != null ? { presencePenalty } : {}),
        ...(maxTokens != null ? { maxTokens } : {}),
        ...(temperature != null ? { temperature } : {}),
        ...(topP != null ? { topP } : {})
    };

    const warnings = [];
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
class AxToSDKTransformer extends TransformStream {
    usage = {
        promptTokens: 0,
        completionTokens: 0
    };
    finishReason = 'other';
    constructor() {
        const transformer = {
            transform: (chunk, controller) => {
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
            flush: (controller) => {
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
//# sourceMappingURL=index.js.map