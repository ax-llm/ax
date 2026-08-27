// ax-example:start
// title: Portable Runtime Hooks
// group: generation
// description: Applies global and forward-scoped rate limiting, tracing, and metrics to AxGen, AxAgent, and AxFlow.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 46
// ax-example:end
import type { AxRateLimiterFunction, AxRuntimeHooks } from '@ax-llm/ax';
import { AxAIOpenAIModel, agent, ai, ax, axGlobals, flow } from '@ax-llm/ax';
import type { Meter, Span, Tracer } from '@opentelemetry/api';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey)
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');

const limiter =
  (label: string): AxRateLimiterFunction =>
  async (next, info) => {
    console.log(
      `[limit:${label}] ${info.operation} ${info.provider}/${info.model} stream=${info.streaming}`
    );
    return next();
  };

const span = (name: string): Span =>
  ({
    addEvent: (event: string) => console.log(`[span:event] ${name} ${event}`),
    addLink: () => undefined,
    addLinks: () => undefined,
    end: () => console.log(`[span:end] ${name}`),
    isRecording: () => true,
    recordException: (error: unknown) =>
      console.log(`[span:error] ${name} ${String(error)}`),
    setAttribute: () => undefined,
    setAttributes: () => undefined,
    setStatus: () => undefined,
    spanContext: () => ({
      traceId: '0'.repeat(32),
      spanId: '0'.repeat(16),
      traceFlags: 0,
    }),
    updateName: () => undefined,
  }) as unknown as Span;

const tracer = {
  startSpan: (name: string) => {
    console.log(`[span:start] ${name}`);
    return span(name);
  },
  startActiveSpan: async (name: string, ...args: unknown[]) => {
    console.log(`[span:start] ${name}`);
    const callback = args.at(-1) as (active: Span) => Promise<unknown>;
    return callback(span(name));
  },
} as Tracer;

const instrument = (name: string) => ({
  add: (value: number) => console.log(`[metric] ${name} += ${value}`),
  record: (value: number) => console.log(`[metric] ${name} = ${value}`),
});
const meter = {
  createCounter: (name: string) => instrument(name),
  createGauge: (name: string) => instrument(name),
  createHistogram: (name: string) => instrument(name),
  createObservableCounter: () => ({}),
  createObservableGauge: () => ({}),
  createObservableUpDownCounter: () => ({}),
  createUpDownCounter: (name: string) => instrument(name),
  createBatchObservableCallback: () => ({ dispose() {} }),
  removeBatchObservableCallback: () => undefined,
} as unknown as Meter;

const llm = ai({
  name: 'openai',
  apiKey,
  config: { model: AxAIOpenAIModel.GPT54Mini, temperature: 0 },
});
const overrideHooks: AxRuntimeHooks = {
  rateLimiter: limiter('forward'),
  tracer,
  meter,
};

axGlobals.rateLimiter = limiter('global');
axGlobals.tracer = tracer;
axGlobals.meter = meter;
try {
  const direct = ax('topic:string -> summary:string');
  console.log(
    await direct.forward(llm, { topic: 'portable Ax runtime hooks' })
  );

  const helper = agent('question:string -> answer:string', {});
  console.log(
    await helper.forward(
      llm,
      { question: 'What does a rate limiter wrap?' },
      overrideHooks
    )
  );

  const workflow = flow(`flowchart TD
    %%ax outline: topic:string -> outline:string
    %%ax polish: outline:string -> answer:string
    outline --> polish`);
  console.log(
    await workflow.forward(llm, { topic: 'Ax runtime hooks' }, overrideHooks)
  );
} finally {
  axGlobals.rateLimiter = undefined;
  axGlobals.tracer = undefined;
  axGlobals.meter = undefined;
}
