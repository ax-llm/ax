import { AxAI, type AxAIGoogleGeminiModel, AxGen } from '@ax-llm/ax';
import { trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  defaultResource,
  resourceFromAttributes,
} from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

/*
Start Jaeger on http://localhost:16686 (Web UI)

docker run --rm --name jaeger \
  -p 16686:16686 \
  -p 4317:4317 \
  -p 4318:4318 \
  -p 5778:5778 \
  -p 9411:9411 \
  jaegertracing/jaeger:2.6.0

*/

// Configure OTLP exporter
const otlpExporter = new OTLPTraceExporter({
  url: 'http://localhost:4318/v1/traces', // OTLP HTTP endpoint
});

// Configure BatchSpanProcessor
const spanProcessor = new BatchSpanProcessor(otlpExporter);

const resource = defaultResource().merge(
  resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'ax-examples',
    [ATTR_SERVICE_VERSION]: '0.0.0',
  })
);

// Set up OpenTelemetry with OTLP
const provider = new BasicTracerProvider({
  spanProcessors: [spanProcessor],
  resource,
});

// Register the provider globally
trace.setGlobalTracerProvider(provider);

const tracer = trace.getTracer('text-classification-example');

// Initialize AI with tracer
const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: {
    model: 'gemini-2.5-flash-preview-04-17' as AxAIGoogleGeminiModel,
    thinking: { includeThoughts: true },
  },
  options: { debug: false, tracer },
  modelInfo: [
    {
      name: 'gemini-2.5-flash-preview-04-17',
      supported: { thinkingBudget: true },
    },
  ],
});

// Create a text classifier using Ax
const classifier = new AxGen<
  { textToClassify: string },
  { category: string; confidence: number }
>(
  `textToClassify:string "The text to classify" -> 
   category:string "The category of the text (business, technology, sports, entertainment, or politics)",
   confidence:number "Confidence score between 0 and 1"`
);

classifier.setExamples([
  { textToClassify: 'Apple', category: 'business', confidence: 0.95 },
  {
    textToClassify: 'The latest AI breakthrough enables robots to learn',
    category: 'technology',
    confidence: 0.9,
  },
  { textToClassify: 'Politics', category: 'politics', confidence: 0.8 },
  {
    textToClassify: 'Entertainment',
    category: 'entertainment',
    confidence: 0.75,
  },
]);

// Example texts to classify
const texts = [
  "Apple's stock price surged 5% after announcing record iPhone sales",
  'The latest AI breakthrough enables robots to learn from human demonstrations',
  'Manchester United wins dramatic match against Liverpool in injury time',
];

async function main() {
  console.log('Starting text classification with OpenTelemetry tracing...\n');

  try {
    for (const textToClassify of texts) {
      const result = await classifier.forward(
        ai,
        { textToClassify },
        { traceLabel: 'Classifier', thinkingTokenBudget: 'low' }
      );

      console.log('Result:', result);
      console.log('---\n');
    }
  } finally {
    await provider.forceFlush();

    // wait for 3 seconds to ensure all traces are flushed
    console.log('Waiting for 3 seconds to ensure all traces are flushed...');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await provider.shutdown();
    console.log('OpenTelemetry provider shut down.');
  }
}

main().catch(console.error);
