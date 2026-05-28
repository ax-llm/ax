import type { AxAIService, AxChatResponse } from '@ax-llm/ax';
import {
  AxAIAnthropicModel,
  AxAIGoogleGeminiModel,
  AxAIOpenAIModel,
  ai,
  ax,
} from '@ax-llm/ax';

type SupportedProvider = 'openai' | 'anthropic' | 'google-gemini';

type BenchSample = {
  name: string;
  durationMs: number;
  chars: number;
  chunks: number;
  totalTokens?: number;
};

const provider = readProvider();
const runs = readPositiveInt('AX_STREAM_BENCH_RUNS', 3);
const warmupRuns = readNonNegativeInt('AX_STREAM_BENCH_WARMUP_RUNS', 1);
const modelConfig = {
  maxTokens: readPositiveInt('AX_STREAM_BENCH_MAX_TOKENS', 512),
  temperature: 0,
};
const timeout = readNonNegativeInt('AX_STREAM_BENCH_TIMEOUT_MS', 30_000);

const { llm, model } = createLLM(provider);

const chatPrompt = [
  {
    role: 'system' as const,
    content:
      'You are a concise benchmark assistant. Follow formatting requests exactly.',
  },
  {
    role: 'user' as const,
    content:
      'In exactly four short sentences, explain why streaming responses can improve perceived latency.',
  },
];

const gen = ax(
  'topic:string "Topic to explain" -> answer:string "Exactly four short sentences"'
);

const genInput = {
  topic: 'why streaming responses can improve perceived latency',
};

const cases = [
  {
    name: 'ai.chat stream=false',
    run: () => measureChat(false),
  },
  {
    name: 'ai.chat stream=true',
    run: () => measureChat(true),
  },
  {
    name: 'gen.forward stream=false',
    run: () => measureGen(false),
  },
  {
    name: 'gen.forward stream=true',
    run: () => measureGen(true),
  },
];

console.log('=== Ax Streaming Latency Benchmark ===');
console.log(`Provider: ${provider}`);
console.log(`Model: ${model}`);
console.log(`Runs per case: ${runs}`);
console.log(`Warmup runs per case: ${warmupRuns}`);
console.log(`Max tokens: ${modelConfig.maxTokens}`);
console.log(`Timeout: ${timeout} ms`);
console.log('');

for (let i = 0; i < warmupRuns; i++) {
  for (const benchCase of cases) {
    await benchCase.run();
  }
}

const samples: BenchSample[] = [];

for (let i = 0; i < runs; i++) {
  const orderedCases = i % 2 === 0 ? cases : [...cases].reverse();
  for (const benchCase of orderedCases) {
    const sample = await benchCase.run();
    samples.push(sample);
    console.log(formatSample(i + 1, sample));
  }
}

console.log('\nSummary');
console.table(summarize(samples));

console.log(
  [
    'Notes:',
    '- Warmup calls are excluded from the table.',
    '- Network and provider queueing variance can dominate small differences.',
    '- Compare stream=true and stream=false within the same API shape first.',
  ].join('\n')
);

async function measureChat(stream: boolean): Promise<BenchSample> {
  const start = performance.now();
  const response = await llm.chat(
    {
      chatPrompt,
      model,
      modelConfig,
    },
    {
      stream,
      debug: false,
    }
  );
  const collected = await collectChat(response);

  return {
    name: `ai.chat stream=${stream}`,
    durationMs: performance.now() - start,
    chars: collected.chars,
    chunks: collected.chunks,
    totalTokens: collected.totalTokens,
  };
}

async function measureGen(stream: boolean): Promise<BenchSample> {
  gen.resetUsage();
  const start = performance.now();
  const result = await gen.forward(llm, genInput, {
    stream,
    maxRetries: 0,
    maxSteps: 1,
    model,
    modelConfig,
    debug: false,
  });

  return {
    name: `gen.forward stream=${stream}`,
    durationMs: performance.now() - start,
    chars: result.answer.length,
    chunks: 0,
    totalTokens: gen.getUsage().at(-1)?.tokens?.totalTokens,
  };
}

async function collectChat(
  response: AxChatResponse | ReadableStream<AxChatResponse>
): Promise<{ chars: number; chunks: number; totalTokens?: number }> {
  if (!(response instanceof ReadableStream)) {
    return {
      chars: responseText(response).length,
      chunks: 1,
      totalTokens: response.modelUsage?.tokens?.totalTokens,
    };
  }

  let text = '';
  let chunks = 0;
  let totalTokens: number | undefined;
  const reader = response.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks++;
      text += responseText(value);
      totalTokens = value.modelUsage?.tokens?.totalTokens ?? totalTokens;
    }
  } finally {
    reader.releaseLock();
  }

  return {
    chars: text.length,
    chunks,
    totalTokens,
  };
}

function responseText(response: AxChatResponse): string {
  return response.results.map((result) => result.content ?? '').join('');
}

function summarize(samples: readonly BenchSample[]) {
  const names = [...new Set(samples.map((sample) => sample.name))];
  return names.map((name) => {
    const matching = samples.filter((sample) => sample.name === name);
    const durations = matching
      .map((sample) => sample.durationMs)
      .sort((a, b) => a - b);
    const chars = matching.map((sample) => sample.chars);
    const chunks = matching.map((sample) => sample.chunks);
    const totalTokens = matching
      .map((sample) => sample.totalTokens)
      .filter((value): value is number => value !== undefined);

    return {
      case: name,
      runs: matching.length,
      meanMs: round(mean(durations)),
      medianMs: round(median(durations)),
      minMs: round(durations[0] ?? 0),
      maxMs: round(durations.at(-1) ?? 0),
      meanChars: round(mean(chars)),
      meanChunks: round(mean(chunks)),
      meanTokens: round(mean(totalTokens)),
    };
  });
}

function formatSample(run: number, sample: BenchSample): string {
  const duration = round(sample.durationMs).toString().padStart(5, ' ');
  const chunks = sample.chunks.toString().padStart(3, ' ');
  return [
    `run ${run}`,
    sample.name.padEnd(24, ' '),
    `${duration} ms`,
    `${sample.chars} chars`,
    `${sample.totalTokens ?? '-'} tokens`,
    `${chunks} chunks`,
  ].join(' | ');
}

function readProvider(): SupportedProvider {
  const value = process.env.AX_STREAM_BENCH_PROVIDER ?? 'openai';
  if (
    value === 'openai' ||
    value === 'anthropic' ||
    value === 'google-gemini'
  ) {
    return value;
  }
  throw new Error(
    'AX_STREAM_BENCH_PROVIDER must be openai, anthropic, or google-gemini'
  );
}

function createLLM(selectedProvider: SupportedProvider): {
  llm: Readonly<AxAIService>;
  model: string;
} {
  switch (selectedProvider) {
    case 'openai': {
      const model = (process.env.AX_STREAM_BENCH_MODEL ??
        AxAIOpenAIModel.GPT41Nano) as AxAIOpenAIModel;
      return {
        model,
        llm: ai({
          name: 'openai',
          apiKey: readRequiredEnv('OPENAI_APIKEY'),
          config: { model },
          options: { timeout },
        }),
      };
    }

    case 'anthropic': {
      const model = (process.env.AX_STREAM_BENCH_MODEL ??
        AxAIAnthropicModel.Claude45Haiku) as AxAIAnthropicModel;
      return {
        model,
        llm: ai({
          name: 'anthropic',
          apiKey: readRequiredEnv('ANTHROPIC_APIKEY'),
          config: { model },
          options: { timeout },
        }),
      };
    }

    case 'google-gemini': {
      const model = (process.env.AX_STREAM_BENCH_MODEL ??
        AxAIGoogleGeminiModel.Gemini25FlashLite) as AxAIGoogleGeminiModel;
      return {
        model,
        llm: ai({
          name: 'google-gemini',
          apiKey: readRequiredEnv('GOOGLE_APIKEY'),
          config: { model },
          options: { timeout },
        }),
      };
    }
  }
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} before running this benchmark.`);
  }
  return value;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function readNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[mid] ?? 0;
  }
  return ((values[mid - 1] ?? 0) + (values[mid] ?? 0)) / 2;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
