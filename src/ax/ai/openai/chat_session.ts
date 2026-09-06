import type { AxChatSession, AxChatSessionEvent } from '../session.js';
import type {
  AxAIServiceOptions,
  AxChatRequest,
  AxFunctionResult,
} from '../types.js';
import { axResolveOpenAIResponsesReasoningEffort } from './effort.js';
import { AxAIOpenAIResponsesImpl } from './responses_api.js';
import type { AxAIOpenAIResponsesClient } from './responses_client.js';
import type {
  AxAIOpenAIResponsesConfig,
  AxAIOpenAIResponsesInputItem,
  AxAIOpenAIResponsesRequest,
  AxAIOpenAIResponsesResponse,
  AxAIOpenAIResponsesSessionEvent,
} from './responses_types.js';
import { axNormalizeOpenAIUsage } from './usage.js';

/** Internal transport adapter. A session never reconnects or replays calls. */
export class AxOpenAIChatSession implements AxChatSession {
  readonly model: string;
  private readonly queue: AxChatSessionEvent[] = [];
  private readonly seenCalls = new Set<string>();
  private readonly seenResponses = new Set<string>();
  private readonly seenSteeringEvents = new Set<string>();
  private readonly abortController = new AbortController();
  private wake?: () => void;
  private closed = false;
  private failure?: unknown;
  private active = false;
  private consumed = false;
  private previousId?: string;
  private input: AxAIOpenAIResponsesInputItem[] = [];
  private socket?: Awaited<ReturnType<AxAIOpenAIResponsesClient['connect']>>;
  private readonly request: AxAIOpenAIResponsesRequest<string>;
  private readonly mapper: AxAIOpenAIResponsesImpl<
    string,
    string,
    AxAIOpenAIResponsesRequest<string>
  >;
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  private readonly onAbort = () =>
    this.fail(this.options.abortSignal?.reason ?? new Error('Session aborted'));

  constructor(
    private readonly client: AxAIOpenAIResponsesClient,
    req: AxChatRequest,
    private readonly options: AxAIServiceOptions,
    config?: AxAIOpenAIResponsesConfig<string, string>
  ) {
    this.model = String(req.model);
    this.mapper = new AxAIOpenAIResponsesImpl(
      { ...config, model: this.model },
      true,
      options
    );
    const [, request] = this.mapper.createChatReq(
      { ...req, model: this.model },
      options
    );
    this.request = {
      ...request,
      tools: request.tools?.map((tool) =>
        tool.type === 'function' &&
        req.functions?.some(
          (f) => f.name === tool.name && f.execution === 'background'
        )
          ? { ...tool, async: true }
          : tool
      ),
      stream: true,
    };
    options.abortSignal?.addEventListener('abort', this.onAbort, {
      once: true,
    });
  }

  async start(): Promise<this> {
    if (this.options.abortSignal?.aborted) {
      this.onAbort();
      throw this.failure;
    }
    if (this.options.webSocket) {
      this.socket = await this.client.connect({
        ...this.options,
        abortSignal: this.abortController.signal,
      });
      void this.read(this.socket.events());
    }
    await this.send(this.request);
    return this;
  }

  private emit(event: AxChatSessionEvent): void {
    this.queue.push(event);
    this.wake?.();
  }
  private fail(error: unknown): void {
    this.failure = error;
    this.close();
  }

  private async read(
    events: AsyncIterable<AxAIOpenAIResponsesSessionEvent>
  ): Promise<void> {
    try {
      for await (const event of events) {
        if (this.closed) break;
        if (event.type === 'response.created') {
          this.previousId = event.response.id;
          this.active = true;
        }
        if (
          event.type === 'response.output_item.done' &&
          event.item.type === 'function_call'
        ) {
          const item = event.item;
          if (!this.seenCalls.has(item.call_id)) {
            this.seenCalls.add(item.call_id);
            this.emit({
              type: 'tool.call',
              responseId: this.previousId!,
              call: {
                id: item.call_id,
                type: 'function',
                function: { name: item.name, params: item.arguments },
              },
            });
          }
        }
        if (
          event.type === 'response.completed' ||
          (event.type === 'response.incomplete' &&
            event.response.incomplete_details?.reason === 'steered')
        ) {
          this.active = false;
          this.previousId = event.response.id;
          if (!this.seenResponses.has(event.response.id)) {
            this.seenResponses.add(event.response.id);
            this.emit({
              type: 'response.completed',
              responseId: event.response.id,
              response: this.normalize(event.response),
            });
          }
        } else if (
          event.type === 'response.failed' ||
          event.type === 'response.incomplete' ||
          event.type === 'error'
        ) {
          throw new Error(`Responses session failed: ${JSON.stringify(event)}`);
        } else if (
          event.type === 'response.steer.accepted' ||
          event.type === 'response.steer.pending' ||
          event.type === 'response.steer.failed'
        ) {
          const key = `${event.type}:${event.steer.id ?? event.sequence_number}:${event.type === 'response.steer.pending' ? JSON.stringify(event.required_input) : ''}`;
          if (this.seenSteeringEvents.has(key)) continue;
          this.seenSteeringEvents.add(key);
          const status =
            event.type === 'response.steer.accepted'
              ? 'accepted'
              : event.type === 'response.steer.pending'
                ? 'pending'
                : 'failed';
          this.emit({
            type: 'steering',
            status,
            responseId: event.steer.previous_response_id,
            steerId: event.steer.id,
            ...(event.type === 'response.steer.pending'
              ? {
                  requiredCallIds: event.required_input.flatMap((input) =>
                    input.call_id ? [input.call_id] : []
                  ),
                }
              : {}),
            ...(event.type === 'response.steer.failed'
              ? { error: event.error.message }
              : {}),
          });
        } else if (event.type === 'response.output_text.delta') {
          this.emit({
            type: 'response',
            responseId: this.previousId!,
            response: { results: [{ index: 0, content: event.delta }] },
          });
        }
      }
    } catch (error) {
      if (!this.closed) this.fail(error);
    }
  }

  private normalize(response: AxAIOpenAIResponsesResponse) {
    return {
      ...this.mapper.createChatResp(response),
      modelUsage: {
        ai: 'openai-responses',
        model: response.model,
        tokens: axNormalizeOpenAIUsage(
          response.usage,
          response.service_tier_used ?? response.service_tier
        ),
      },
    };
  }

  private async send(
    request: AxAIOpenAIResponsesRequest<string>
  ): Promise<void> {
    if (this.closed) throw this.failure ?? new Error('Session closed');
    if (this.active) throw new Error('A response is already active');
    this.active = true;
    try {
      if (this.socket) {
        const socket = this.socket;
        const issue = async () => {
          socket.create(request);
        };
        if (this.options.rateLimiter)
          await this.options.rateLimiter(issue, {
            operation: 'chat',
            provider: 'openai',
            ai: 'openai',
            model: this.model,
            streaming: true,
            previousModelUsage: this.client.getUsage().at(-1),
          });
        else await issue();
      } else {
        const issue = () =>
          this.client.create(
            { ...request, stream: true },
            { ...this.options, abortSignal: this.abortController.signal }
          );
        const events = this.options.rateLimiter
          ? await this.options.rateLimiter(issue, {
              operation: 'chat',
              provider: 'openai',
              ai: 'openai',
              model: this.model,
              streaming: true,
            })
          : await issue();
        if (events instanceof ReadableStream)
          throw new Error(
            'Session rate limiter must return the request result'
          );
        void this.read(events);
      }
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async submitToolResults(results: readonly AxFunctionResult[]): Promise<void> {
    if (this.closed) throw this.failure ?? new Error('Session closed');
    this.input = [
      ...this.input,
      ...results.map((result) => ({
        type: 'function_call_output' as const,
        call_id: result.functionId,
        output: result.result,
      })),
    ];
  }

  async continue(): Promise<void> {
    if (this.active) throw new Error('Cannot continue an active response');
    const input = this.input;
    this.input = [];
    await this.send({
      ...this.request,
      previous_response_id: this.previousId,
      input,
    });
  }

  async steer(text: string): Promise<'native' | 'next-response'> {
    if (this.socket && this.active && this.previousId) {
      this.socket.steer({
        previous_response_id: this.previousId,
        input: [{ type: 'message', role: 'user', content: text }],
      });
      return 'native';
    }
    this.input = [
      ...this.input,
      { type: 'message', role: 'user', content: text },
    ];
    return 'next-response';
  }

  async setThinkingTokenBudget(
    level: NonNullable<AxAIServiceOptions['thinkingTokenBudget']>
  ): Promise<'next-response'> {
    const effort = axResolveOpenAIResponsesReasoningEffort(this.model, level);
    const items = [...this.input];
    const last = items.at(-1);
    if (
      last &&
      typeof last !== 'string' &&
      last.type === 'configuration_update'
    )
      items.pop();
    if (!effort || effort === 'none' || effort === 'minimal')
      throw new Error('Unsupported session reasoning level');
    items.push({ type: 'configuration_update', reasoning: { effort } });
    this.input = items;
    return 'next-response';
  }

  async *events(): AsyncIterable<AxChatSessionEvent> {
    if (this.consumed)
      throw new Error('Session events already have a consumer');
    this.consumed = true;
    while (true) {
      if (this.queue.length) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.failure) throw this.failure;
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = undefined;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abortController.abort(
      this.failure ?? new Error('Chat session closed')
    );
    this.socket?.close();
    this.options.abortSignal?.removeEventListener('abort', this.onAbort);
    this.wake?.();
  }
}
