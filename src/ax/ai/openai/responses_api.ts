import { AxAIRefusalError } from '../../util/apicall.js'
import type {
  AxAIPromptConfig,
  AxAIServiceImpl,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxInternalChatRequest,
  AxInternalEmbedRequest,
  AxModelConfig,
  AxTokenUsage,
} from '../types.js'

import type {
  AxAIOpenAIResponsesCodeInterpreterToolCall,
  AxAIOpenAIResponsesComputerToolCall,
  AxAIOpenAIResponsesConfig,
  AxAIOpenAIResponsesDefineFunctionTool,
  AxAIOpenAIResponsesFileSearchToolCall,
  AxAIOpenAIResponsesImageGenerationToolCall,
  AxAIOpenAIResponsesInputContentPart,
  AxAIOpenAIResponsesInputItem,
  AxAIOpenAIResponsesInputMessageItem,
  AxAIOpenAIResponsesLocalShellToolCall,
  AxAIOpenAIResponsesMCPToolCall,
  AxAIOpenAIResponsesOutputRefusalContentPart,
  AxAIOpenAIResponsesOutputTextContentPart,
  AxAIOpenAIResponsesRequest,
  AxAIOpenAIResponsesResponse,
  AxAIOpenAIResponsesResponseDelta,
  AxAIOpenAIResponsesStreamEvent,
  AxAIOpenAIResponsesToolDefinition,
  AxAIOpenAIResponsesWebSearchToolCall,
  Mutable,
  RequestFunctionDefinition,
  ResponsesReqUpdater,
  UserMessageContentItem,
} from './responses_types.js'
import { AxAIOpenAIResponsesModel } from './responses_types.js'

import type {
  AxAIOpenAIEmbedRequest,
  AxAIOpenAIEmbedResponse,
  AxAPI,
} from '@ax-llm/ax/index.js'

/**
 * Checks if the given OpenAI Responses model is a thinking/reasoning model.
 * Thinking models (o1, o3, o4 series) have different parameter restrictions.
 */
export const isOpenAIResponsesThinkingModel = (model: string): boolean => {
  const thinkingModels = [
    AxAIOpenAIResponsesModel.O1,
    AxAIOpenAIResponsesModel.O1Mini,
    AxAIOpenAIResponsesModel.O1Pro,
    AxAIOpenAIResponsesModel.O3,
    AxAIOpenAIResponsesModel.O3Mini,
    AxAIOpenAIResponsesModel.O3Pro,
    AxAIOpenAIResponsesModel.O4Mini,
  ]
  return thinkingModels.includes(model as AxAIOpenAIResponsesModel)
}

export class AxAIOpenAIResponsesImpl<
  TModel,
  TEmbedModel, // Kept for interface compatibility, but not used by this impl.
  TResponsesReq extends AxAIOpenAIResponsesRequest<TModel>,
> implements
    AxAIServiceImpl<
      TModel,
      TEmbedModel,
      Readonly<AxAIOpenAIResponsesRequest<TModel>>, // ChatReq (now ResponsesReq)
      Readonly<AxAIOpenAIEmbedRequest<TEmbedModel>>, // EmbedReq
      Readonly<AxAIOpenAIResponsesResponse>, // ChatResp (now ResponsesResp)
      Readonly<AxAIOpenAIResponsesResponseDelta>, // ChatRespDelta (now ResponsesRespDelta)
      Readonly<AxAIOpenAIEmbedResponse> // EmbedResp
    >
{
  private tokensUsed: AxTokenUsage | undefined

  constructor(
    private readonly config: Readonly<
      AxAIOpenAIResponsesConfig<TModel, TEmbedModel>
    >,
    private readonly streamingUsage: boolean, // If /v1/responses supports include_usage for streams
    private readonly responsesReqUpdater?: ResponsesReqUpdater<
      TModel,
      TResponsesReq
    >
  ) {}

  getTokenUsage(): Readonly<AxTokenUsage> | undefined {
    return this.tokensUsed
  }

  getModelConfig(): Readonly<AxModelConfig> {
    const { config } = this
    return {
      maxTokens: config.maxTokens, // maps to max_output_tokens
      temperature: config.temperature,
      // presencePenalty, frequencyPenalty are not direct params in /v1/responses
      stopSequences: config.stopSequences, // /v1/responses uses 'truncation' or relies on item structure
      topP: config.topP,
      // n: config.n, // Not a direct parameter in /v1/responses
      stream: config.stream,
    }
  }

  private mapInternalContentToResponsesInput(
    content: ReadonlyArray<UserMessageContentItem> // Expects an array of content items, string case handled by caller
  ): ReadonlyArray<AxAIOpenAIResponsesInputContentPart> {
    const mappedParts: Mutable<AxAIOpenAIResponsesInputContentPart>[] =
      content.map((part: UserMessageContentItem) => {
        // AxUserMessageContentItem ensures part is one of {type: text}, {type: image}, {type: audio}
        if (part.type === 'text') {
          return { type: 'text', text: part.text }
        } else if (part.type === 'image') {
          const url = `data:${part.mimeType};base64,` + part.image
          return {
            type: 'image_url',
            image_url: { url, details: part.details ?? 'auto' },
          }
        } else if (part.type === 'audio') {
          return {
            type: 'input_audio',
            input_audio: { data: part.data, format: part.format ?? 'wav' },
          }
        }
        // This should be exhaustive given AxUserMessageContentItem's definition
        const _exhaustiveCheck: never = part
        throw new Error(
          `Unsupported content part: ${JSON.stringify(_exhaustiveCheck)}`
        )
      })
    return mappedParts as ReadonlyArray<AxAIOpenAIResponsesInputContentPart>
  }

  private createResponsesReqInternalInput(
    chatPrompt: ReadonlyArray<AxChatRequest<TModel>['chatPrompt'][number]>,
    excludeSystemMessages: boolean = false // New parameter
  ): ReadonlyArray<AxAIOpenAIResponsesInputItem> {
    // Map from AxChatPromptItemType roles to AxAIOpenAI /v1/responses API roles:
    // - 'system' -> 'system' (may be skipped if excludeSystemMessages is true)
    // - 'user' -> 'user'
    // - 'assistant' -> 'assistant'
    // - 'function' -> Special handling for function call outputs (different structure)
    //
    // Note: AxAIOpenAI's /v1/responses API also supports a 'developer' role that isn't
    // currently mapped from our AxChatPromptItemType structure.

    const items: Mutable<AxAIOpenAIResponsesInputItem>[] = []
    for (const msg of chatPrompt) {
      if (excludeSystemMessages && msg.role === 'system') {
        continue // Skip system messages if they are handled by top-level 'instructions'
      }

      let mappedContent:
        | string
        | ReadonlyArray<AxAIOpenAIResponsesInputContentPart>
      // Type guard for content based on role
      if (
        msg.role === 'system' ||
        msg.role === 'user' ||
        (msg.role === 'assistant' && msg.content)
      ) {
        if (typeof msg.content === 'string') {
          mappedContent = msg.content
        } else if (Array.isArray(msg.content)) {
          // Only for user role typically
          mappedContent = this.mapInternalContentToResponsesInput(
            msg.content as ReadonlyArray<UserMessageContentItem>
          )
        } else {
          // Handle cases where content might be undefined for assistant, or unexpected type
          if (msg.role === 'assistant' && !msg.content && msg.functionCalls) {
            // This is fine, assistant message can be just functionCalls
          } else {
            throw new Error(`Invalid content type for role ${msg.role}`)
          }
          mappedContent = '' // Default or skip
        }
      } else if (msg.role === 'function') {
        // Function role does not have 'content' in the same way, it has 'result'
        mappedContent = '' // Placeholder, not directly used for content field in function_call_output
      } else {
        mappedContent = '' // Default for roles that might not have content or are handled differently
      }

      switch (msg.role) {
        case 'system': // Will be skipped if excludeSystemMessages is true
          items.push({
            type: 'message',
            role: 'system',
            content: mappedContent as string,
          })
          break
        case 'user':
          items.push({
            type: 'message',
            role: 'user',
            content: mappedContent,
            name: msg.name,
          })
          break
        case 'assistant':
          if (msg.content || msg.functionCalls) {
            // Assistant can have content, functionCalls, or both
            const assistantMessage: Mutable<AxAIOpenAIResponsesInputMessageItem> =
              {
                type: 'message',
                role: 'assistant',
                content: '',
              } // Start with empty content
            if (msg.content) {
              assistantMessage.content = mappedContent
            }
            if (msg.name) {
              assistantMessage.name = msg.name
            }
            // If only function calls, content might remain empty or not be applicable in the same way for AxAIOpenAI item
            // AxAIOpenAI /v1/responses expects assistant messages with tool calls to be structured carefully.
            // For now, pushing the textual content if present. Tool calls are separate items.
            if (msg.content)
              items.push(
                assistantMessage as AxAIOpenAIResponsesInputMessageItem
              )

            if (msg.functionCalls) {
              for (const call of msg.functionCalls) {
                items.push({
                  type: 'function_call',
                  call_id: call.id,
                  name: call.function.name,
                  arguments:
                    typeof call.function.params === 'object'
                      ? JSON.stringify(call.function.params)
                      : call.function.params || '',
                })
              }
            }
          }
          break
        case 'function': // This is a tool result
          items.push({
            type: 'function_call_output',
            call_id: msg.functionId!,
            output: msg.result!,
          })
          break
        default:
          // Fix for any type
          const invalidRole = (msg as { role: string }).role
          throw new Error(`Invalid role in chat prompt: ${invalidRole}`)
      }
    }
    return items as ReadonlyArray<AxAIOpenAIResponsesInputItem>
  }

  createChatReq(
    req: Readonly<AxInternalChatRequest<TModel>>,
    config: Readonly<AxAIPromptConfig>
  ): [Readonly<AxAPI>, Readonly<AxAIOpenAIResponsesRequest<TModel>>] {
    const model = req.model
    const apiConfig: Readonly<AxAPI> = { name: '/responses' }

    let instructionsFromPrompt: string | null = null
    let systemMessageFoundAndUsed = false
    if (req.chatPrompt) {
      for (const item of req.chatPrompt) {
        if (item.role === 'system' && typeof item.content === 'string') {
          instructionsFromPrompt = item.content
          systemMessageFoundAndUsed = true
          break
        }
      }
    }

    const finalInstructions =
      instructionsFromPrompt ?? this.config.systemPrompt ?? null

    const tools: ReadonlyArray<AxAIOpenAIResponsesToolDefinition> | undefined =
      req.functions?.map(
        (
          v: Readonly<RequestFunctionDefinition>
        ): AxAIOpenAIResponsesDefineFunctionTool => ({
          type: 'function' as const,
          name: v.name,
          description: v.description,
          parameters: v.parameters ?? {},
        })
      )

    // Set include field based on showThoughts option, but override if thinkingTokenBudget is 'none'
    const includeFields: // | 'file_search_call.results'
    'message.input_image.image_url'[] =
      // | 'computer_call_output.output.image_url'
      // | 'reasoning.encrypted_content'
      // | 'code_interpreter_call.outputs'
      []

    const isThinkingModel = isOpenAIResponsesThinkingModel(model as string)

    let reasoningSummary = this.config.reasoningSummary

    if (!config?.showThoughts) {
      reasoningSummary = undefined
    } else if (!reasoningSummary) {
      reasoningSummary = 'auto'
    }

    let reasoningEffort = this.config.reasoningEffort

    // Handle thinkingTokenBudget config parameter
    if (config?.thinkingTokenBudget) {
      switch (config.thinkingTokenBudget) {
        case 'none':
          reasoningEffort = undefined
          break
        case 'minimal':
          reasoningEffort = 'low'
          break
        case 'low':
          reasoningEffort = 'medium'
          break
        case 'medium':
        case 'high':
        case 'highest':
          reasoningEffort = 'high'
          break
      }
    }

    let mutableReq: Mutable<AxAIOpenAIResponsesRequest<TModel>> = {
      model,
      input: '', // Will be set below
      instructions: finalInstructions,
      tools: tools?.length ? tools : undefined,
      tool_choice:
        req.functionCall === 'none' ||
        req.functionCall === 'auto' ||
        req.functionCall === 'required'
          ? req.functionCall
          : typeof req.functionCall === 'object' && req.functionCall.function
            ? { type: 'function', name: req.functionCall.function.name }
            : undefined,
      // For thinking models, don't set these parameters as they're not supported
      ...(isThinkingModel
        ? {
            max_output_tokens:
              req.modelConfig?.maxTokens ?? this.config.maxTokens ?? undefined,
          }
        : {
            temperature:
              req.modelConfig?.temperature ??
              this.config.temperature ??
              undefined,
            top_p: req.modelConfig?.topP ?? this.config.topP ?? undefined,
            presence_penalty:
              req.modelConfig?.presencePenalty ??
              this.config.presencePenalty ??
              undefined,
            frequency_penalty:
              req.modelConfig?.frequencyPenalty ??
              this.config.frequencyPenalty ??
              undefined,
          }),
      stream: req.modelConfig?.stream ?? this.config.stream ?? false, // Sourced from modelConfig or global config
      // Optional fields from AxAIOpenAIResponsesRequest that need to be in Mutable for initialization
      background: undefined,
      include: includeFields.length > 0 ? includeFields : undefined,
      metadata: undefined,
      parallel_tool_calls: this.config.parallelToolCalls,
      previous_response_id: undefined,
      ...(reasoningEffort
        ? {
            reasoning: {
              effort: reasoningEffort,
              summary: reasoningSummary,
            },
          }
        : {}),
      service_tier: this.config.serviceTier,
      store: this.config.store,
      text: undefined,
      truncation: undefined,
      user: this.config.user,
      seed: this.config.seed,
    }

    // Populate from this.config if properties exist on AxAIOpenAIConfig
    if (this.config.user) mutableReq.user = this.config.user
    if (this.config.parallelToolCalls !== undefined)
      mutableReq.parallel_tool_calls = this.config.parallelToolCalls
    if (this.config.responseFormat)
      mutableReq.text = {
        format: {
          type: this.config.responseFormat as
            | 'text'
            | 'json_object'
            | 'json_schema',
        },
      }
    if (this.config.seed) mutableReq.seed = this.config.seed
    // TODO: Check AxAIOpenAIConfig for other fields like store, background, include, metadata, service_tier, truncation

    const inputItems = req.chatPrompt
      ? this.createResponsesReqInternalInput(
          req.chatPrompt,
          systemMessageFoundAndUsed
        )
      : []

    if (inputItems.length > 0) {
      mutableReq.input = inputItems
    } else if (
      req.chatPrompt &&
      req.chatPrompt.length === 1 &&
      req.chatPrompt[0]?.role === 'user' &&
      req.chatPrompt[0]?.content &&
      typeof req.chatPrompt[0].content === 'string' &&
      !finalInstructions
    ) {
      // Fallback to simple string input if only one user message and no instructions
      mutableReq.input = req.chatPrompt[0].content
    } else if (inputItems.length === 0 && !finalInstructions) {
      throw new Error('Responses API request must have input or instructions.')
    }

    let currentReasoning = mutableReq.reasoning ?? {}
    if (this.config.reasoningEffort) {
      currentReasoning = {
        ...currentReasoning,
        effort: this.config.reasoningEffort,
      }
    }

    // Handle thinkingTokenBudget config parameter
    if (config?.thinkingTokenBudget) {
      switch (config.thinkingTokenBudget) {
        case 'none':
          // When thinkingTokenBudget is 'none', remove reasoning entirely
          currentReasoning = {}
          break
        case 'minimal':
          currentReasoning = {
            ...currentReasoning,
            effort: 'low',
          }
          break
        case 'low':
          currentReasoning = {
            ...currentReasoning,
            effort: 'medium',
          }
          break
        case 'medium':
        case 'high':
        case 'highest':
          currentReasoning = {
            ...currentReasoning,
            effort: 'high',
          }
          break
      }
    }

    if (Object.keys(currentReasoning).length > 0 && currentReasoning.effort) {
      mutableReq.reasoning = currentReasoning
    } else {
      delete mutableReq.reasoning // Ensure reasoning is not sent if empty or only has non-effort keys by mistake
    }

    let finalReqToProcess: Readonly<AxAIOpenAIResponsesRequest<TModel>> =
      mutableReq as Readonly<AxAIOpenAIResponsesRequest<TModel>>

    if (this.responsesReqUpdater) {
      finalReqToProcess = this.responsesReqUpdater(
        finalReqToProcess as Readonly<TResponsesReq>
      )
    }

    return [apiConfig, finalReqToProcess]
  }

  // Create Chat Response from /v1/responses (non-streaming)
  createChatResp(
    resp: Readonly<AxAIOpenAIResponsesResponse>
  ): Readonly<AxChatResponse> {
    const { id, output, usage } = resp

    if (usage) {
      this.tokensUsed = {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      }
    }

    let currentResult: Partial<AxChatResponseResult> = {}

    for (const item of output ?? []) {
      switch (item.type) {
        case 'message':
          currentResult.id = item.id
          currentResult.content = contentToText(item.content, id)
          currentResult.finishReason =
            item.status === 'completed' ? 'stop' : 'content_filter'
          break

        case 'reasoning':
          currentResult.id = item.id
          // Use encrypted_content if available (when showThoughts is enabled), otherwise use summary
          if (item.encrypted_content) {
            currentResult.thought = item.encrypted_content
          } else {
            currentResult.thought = item.summary
              .map((s: string | object) =>
                typeof s === 'object' ? JSON.stringify(s) : s
              )
              .join('\n')
          }
          break

        case 'file_search_call':
          currentResult.id = item.id
          currentResult.functionCalls = [
            {
              id: item.id,
              type: 'function' as const,
              function: {
                name: 'file_search',
                params: {
                  queries: item.queries,
                  results: item.results,
                },
              },
            },
          ]
          currentResult.finishReason = 'function_call'
          break
        case 'web_search_call':
          currentResult.id = item.id
          currentResult.functionCalls = [
            {
              id: item.id,
              type: 'function' as const,
              function: {
                name: 'web_search',
                params: {
                  queries: item.queries,
                },
              },
            },
          ]
          currentResult.finishReason = 'function_call'
          break
        case 'computer_call':
          currentResult.id = item.id
          currentResult.functionCalls = [
            {
              id: item.id,
              type: 'function' as const,
              function: {
                name: 'computer_use',
                params: {
                  action: item.action,
                },
              },
            },
          ]
          currentResult.finishReason = 'function_call'
          break
        case 'code_interpreter_call':
          currentResult.id = item.id
          currentResult.functionCalls = [
            {
              id: item.id,
              type: 'function' as const,
              function: {
                name: 'code_interpreter',
                params: {
                  code: item.code,
                  results: item.results,
                },
              },
            },
          ]
          currentResult.finishReason = 'function_call'
          break
        case 'image_generation_call':
          currentResult.id = item.id
          currentResult.functionCalls = [
            {
              id: item.id,
              type: 'function' as const,
              function: {
                name: 'image_generation',
                params: {
                  result: item.result,
                },
              },
            },
          ]
          currentResult.finishReason = 'function_call'
          break
        case 'local_shell_call':
          currentResult.id = item.id
          currentResult.functionCalls = [
            {
              id: item.id,
              type: 'function' as const,
              function: {
                name: 'local_shell',
                params: {
                  action: item.action,
                },
              },
            },
          ]
          currentResult.finishReason = 'function_call'
          break
        case 'mcp_call':
          currentResult.id = item.id
          currentResult.functionCalls = [
            {
              id: item.id,
              type: 'function' as const,
              function: {
                name: 'mcp',
                params: {
                  name: item.name,
                  args: item.args,
                  serverLabel: item.server_label,
                  output: item.output,
                  error: item.error,
                },
              },
            },
          ]
          currentResult.finishReason = 'function_call'
          break
        case 'function_call':
          currentResult.id = item.id
          currentResult.functionCalls = [
            {
              id: item.id,
              type: 'function' as const,
              function: {
                name: item.name,
                params: item.arguments,
              },
            },
          ]
          currentResult.finishReason = 'function_call'
          break
      }
    }

    return {
      results: [{ ...currentResult, index: 0 }],
      remoteId: id,
    }
  }

  // Create Chat Stream Response from /v1/responses stream events
  createChatStreamResp(
    streamEvent: Readonly<AxAIOpenAIResponsesResponseDelta>
  ): Readonly<AxChatResponse> {
    // Handle new streaming event format
    const event = streamEvent as AxAIOpenAIResponsesStreamEvent

    // Create a basic result structure
    const baseResult: AxChatResponseResult = {
      index: 0,
      id: '',
      content: '',
      finishReason: 'stop',
    }

    let remoteId: string | undefined

    switch (event.type) {
      case 'response.created':
      case 'response.in_progress':
      case 'response.queued':
        // Response lifecycle events - return empty content with metadata
        remoteId = event.response.id
        baseResult.id = event.response.id + '_res_0'
        break

      case 'response.output_item.added':
        // New output item added
        switch (event.item.type) {
          case 'message':
            baseResult.id = event.item.id
            baseResult.content = contentToText(
              event.item.content,
              event.item.id
            )
            break
          case 'function_call':
            baseResult.id = event.item.id
            baseResult.functionCalls = [
              {
                id: event.item.id,
                type: 'function' as const,
                function: {
                  name: event.item.name,
                  params: event.item.arguments,
                },
              },
            ]
            break
          case 'file_search_call':
            {
              const fileSearchItem =
                event.item as AxAIOpenAIResponsesFileSearchToolCall
              baseResult.id = event.item.id
              baseResult.functionCalls = [
                {
                  id: fileSearchItem.id,
                  type: 'function' as const,
                  function: {
                    name: 'file_search',
                    params: {
                      queries: fileSearchItem.queries || [],
                      results: fileSearchItem.results?.map((r) => ({
                        fileId: r.file_id,
                        filename: r.filename,
                        score: r.score,
                        text: r.text,
                        attributes: r.attributes,
                      })),
                    },
                  },
                },
              ]
            }
            break
          case 'web_search_call':
            {
              const webSearchItem =
                event.item as AxAIOpenAIResponsesWebSearchToolCall
              baseResult.id = event.item.id
              baseResult.functionCalls = [
                {
                  id: webSearchItem.id,
                  type: 'function' as const,
                  function: {
                    name: 'web_search',
                    params: {
                      queries: webSearchItem.queries || [],
                    },
                  },
                },
              ]
            }
            break
          case 'computer_call':
            {
              const computerItem =
                event.item as AxAIOpenAIResponsesComputerToolCall
              baseResult.id = event.item.id
              baseResult.functionCalls = [
                {
                  id: computerItem.id,
                  type: 'function' as const,
                  function: {
                    name: 'computer_use',
                    params: {
                      action: computerItem.action || {},
                    },
                  },
                },
              ]
            }
            break
          case 'code_interpreter_call':
            {
              const codeItem =
                event.item as AxAIOpenAIResponsesCodeInterpreterToolCall
              baseResult.id = event.item.id
              baseResult.functionCalls = [
                {
                  id: codeItem.id,
                  type: 'function' as const,
                  function: {
                    name: 'code_interpreter',
                    params: {
                      code: codeItem.code || '',
                      results: codeItem.results,
                    },
                  },
                },
              ]
            }
            break
          case 'image_generation_call':
            {
              const imageItem =
                event.item as AxAIOpenAIResponsesImageGenerationToolCall
              baseResult.id = event.item.id
              baseResult.functionCalls = [
                {
                  id: imageItem.id,
                  type: 'function' as const,
                  function: {
                    name: 'image_generation',
                    params: {
                      result: imageItem.result,
                    },
                  },
                },
              ]
            }
            break
          case 'local_shell_call':
            {
              const shellItem =
                event.item as AxAIOpenAIResponsesLocalShellToolCall
              baseResult.id = event.item.id
              baseResult.functionCalls = [
                {
                  id: shellItem.id,
                  type: 'function' as const,
                  function: {
                    name: 'local_shell',
                    params: {
                      action: shellItem.action || {},
                    },
                  },
                },
              ]
            }
            break
          case 'mcp_call':
            {
              const mcpItem = event.item as AxAIOpenAIResponsesMCPToolCall
              baseResult.id = event.item.id
              baseResult.functionCalls = [
                {
                  id: mcpItem.id,
                  type: 'function' as const,
                  function: {
                    name: 'mcp',
                    params: {
                      name: mcpItem.name || '',
                      args: mcpItem.args || '',
                      serverLabel: mcpItem.server_label || '',
                      output: mcpItem.output,
                      error: mcpItem.error,
                    },
                  },
                },
              ]
            }
            break
          // case 'reasoning':
          //     {
          //         const reasoningItem =
          //             event.item as AxAIOpenAIResponsesReasoningItem
          //         baseResult.id = event.item.id
          //         // Use encrypted_content if available (when showThoughts is enabled), otherwise use summary
          //         if (reasoningItem.encrypted_content) {
          //             baseResult.thought = reasoningItem.encrypted_content
          //         } else if (reasoningItem.summary) {
          //             baseResult.thought = reasoningItem.summary
          //                 .map((s: string | object) =>
          //                     typeof s === 'object' ? JSON.stringify(s) : s
          //                 )
          //                 .join('\n')
          //         }
          //     }
          //     break
        }
        break

      case 'response.content_part.added':
        // Content part added - return the initial text if any
        baseResult.id = event.item_id
        baseResult.content = contentToText([event.part], event.item_id)
        break

      case 'response.output_text.delta':
        // Text delta - return just the delta content
        baseResult.id = event.item_id
        baseResult.content = event.delta
        break

      case 'response.output_text.done':
        break

      case 'response.function_call_arguments.delta':
        // Function call arguments delta - return delta with empty name
        baseResult.id = event.item_id
        baseResult.functionCalls = [
          {
            id: event.item_id,
            type: 'function' as const,
            function: {
              name: '',
              params: event.delta,
            },
          },
        ]
        break

      // case 'response.function_call_arguments.done':
      //     // Function call arguments done - don't return function calls here
      //     // The mergeFunctionCalls will handle combining name and arguments
      //     baseResult.id = event.item_id
      //     baseResult.finishReason = 'function_call'
      //     break

      case 'response.reasoning_summary_text.delta':
        // Reasoning summary delta
        baseResult.id = event.item_id
        baseResult.thought = event.delta
        break

      // case 'response.reasoning_summary_text.done':
      //     // Reasoning summary done
      //     baseResult.id = event.item_id
      //     baseResult.thought = event.text
      //     break

      // File search tool events
      case 'response.file_search_call.in_progress':
      case 'response.file_search_call.searching':
        baseResult.id = event.item_id
        baseResult.finishReason = 'function_call'
        break

      case 'response.file_search_call.completed':
        baseResult.id = event.item_id
        baseResult.finishReason = 'function_call'
        break

      // Web search tool events
      case 'response.web_search_call.in_progress':
      case 'response.web_search_call.searching':
        baseResult.id = event.item_id
        baseResult.finishReason = 'function_call'
        break

      case 'response.web_search_call.completed':
        baseResult.id = event.item_id
        baseResult.finishReason = 'function_call'
        break

      // Image generation tool events
      case 'response.image_generation_call.in_progress':
      case 'response.image_generation_call.generating':
        baseResult.id = event.item_id
        baseResult.finishReason = 'function_call'
        break

      case 'response.image_generation_call.completed':
        baseResult.id = event.item_id
        baseResult.finishReason = 'function_call'
        break

      case 'response.image_generation_call.partial_image':
        baseResult.id = event.item_id
        baseResult.finishReason = 'function_call'
        // Could potentially add partial image data to content or a special field
        break

      // MCP tool events
      case 'response.mcp_call.in_progress':
        baseResult.id = event.item_id
        baseResult.finishReason = 'function_call'
        break

      case 'response.mcp_call.arguments.delta':
        baseResult.id = event.item_id
        baseResult.functionCalls = [
          {
            id: event.item_id,
            type: 'function' as const,
            function: {
              name: '',
              params: event.delta,
            },
          },
        ]
        break

      case 'response.mcp_call.arguments.done':
        baseResult.id = event.item_id
        baseResult.functionCalls = [
          {
            id: event.item_id,
            type: 'function' as const,
            function: {
              name: '',
              params: event.arguments,
            },
          },
        ]
        break

      case 'response.mcp_call.completed':
      case 'response.mcp_call.failed':
        // These events don't have item_id, use a generic ID
        baseResult.id = 'mcp_call_event'
        baseResult.finishReason = 'function_call'
        break

      case 'response.mcp_list_tools.in_progress':
      case 'response.mcp_list_tools.completed':
      case 'response.mcp_list_tools.failed':
        // MCP list tools events don't have item_id
        baseResult.id = 'mcp_list_tools_event'
        baseResult.finishReason = 'function_call'
        break

      case 'response.output_item.done':
        // Item completion

        switch (event.item.type) {
          case 'message':
            baseResult.id = event.item.id
            baseResult.finishReason =
              event.item.status === 'completed' ? 'stop' : 'error'
            break
          case 'function_call':
          case 'file_search_call':
          case 'web_search_call':
          case 'computer_call':
          case 'code_interpreter_call':
          case 'image_generation_call':
          case 'local_shell_call':
          case 'mcp_call':
            // Tool calls completed - finishReason indicates function execution needed
            baseResult.id = event.item.id
            baseResult.finishReason = 'function_call'
            break
          // case 'reasoning':
          //     // Reasoning completed
          //     baseResult.id = event.item.id
          //     break
        }
        break

      case 'response.completed':
        // Response completion - handle usage
        if (event.response.usage) {
          this.tokensUsed = {
            promptTokens: event.response.usage.prompt_tokens,
            completionTokens: event.response.usage.completion_tokens,
            totalTokens: event.response.usage.total_tokens,
          }
        }
        remoteId = event.response.id
        baseResult.id = event.response.id + '_completed'
        baseResult.finishReason = 'stop'
        break

      case 'response.failed':
        // Response failure
        remoteId = event.response.id
        baseResult.id = event.response.id + '_failed'
        baseResult.finishReason = 'error'
        break

      case 'response.incomplete':
        // Response incomplete
        remoteId = event.response.id
        baseResult.id = event.response.id + '_incomplete'
        baseResult.finishReason = 'length'
        break

      case 'error':
        // Error event
        baseResult.id = 'error'
        baseResult.content = `Error: ${event.message}`
        baseResult.finishReason = 'error'
        break

      default:
        // For unhandled events, return empty result
        baseResult.id = 'unknown'
        break
    }

    return {
      results: [baseResult],
      remoteId,
    } as Readonly<AxChatResponse>
  }

  createEmbedReq(
    req: Readonly<AxInternalEmbedRequest<TEmbedModel>>
  ): [AxAPI, AxAIOpenAIEmbedRequest<TEmbedModel>] {
    const model = req.embedModel

    if (!model) {
      throw new Error('Embed model not set')
    }

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty')
    }

    const apiConfig = {
      name: '/embeddings',
    }

    const reqValue = {
      model: model,
      input: req.texts,
      dimensions: this.config.dimensions,
    }

    return [apiConfig, reqValue]
  }
}

// const getThought = (item: AxAIOpenAIResponsesReasoningItem): string => {
//     if (item.encrypted_content) {
//         return item.encrypted_content
//     }
//     return item.summary.map((s) => s.text).join('\n')
// }

const contentToText = (
  content: ReadonlyArray<
    | AxAIOpenAIResponsesOutputTextContentPart
    | AxAIOpenAIResponsesOutputRefusalContentPart
  >,
  responseId?: string
): string => {
  // Check for refusal content and throw exception
  const refusalContent = content.filter((c) => c.type === 'refusal')
  if (refusalContent.length > 0) {
    const refusalMessage = refusalContent.map((c) => c.refusal).join('\n')
    throw new AxAIRefusalError(refusalMessage, undefined, responseId)
  }

  // Return only text content
  return content
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('\n')
}
