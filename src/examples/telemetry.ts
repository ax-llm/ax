import { AxAI, AxAIGoogleGeminiModel, AxGen } from '@ax-llm/ax'
import { trace } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'

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
})

// Configure BatchSpanProcessor
const spanProcessor = new BatchSpanProcessor(otlpExporter)

// Set up OpenTelemetry with OTLP
const provider = new BasicTracerProvider({
  spanProcessors: [spanProcessor]
})

// Register the provider globally
trace.setGlobalTracerProvider(provider)

const tracer = trace.getTracer('text-classification-example')

// Create a text classifier using Ax
const classifier = new AxGen<
  { textToClassify: string },
  { category: string; confidence: number }
>(
  `textToClassify:string "The text to classify" -> 
   category:string "The category of the text (business, technology, sports, entertainment, or politics)",
   confidence:number "Confidence score between 0 and 1"`
)

// Initialize AI with tracer
const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: { model: AxAIGoogleGeminiModel.Gemini15Flash8B },
  options: { debug: false }
})

// Example texts to classify
const texts = [
  "Apple's stock price surged 5% after announcing record iPhone sales",
  "The latest AI breakthrough enables robots to learn from human demonstrations",
  "Manchester United wins dramatic match against Liverpool in injury time"
]

async function main() {
  console.log('Starting text classification with OpenTelemetry tracing...\n')

  try {
    for (const textToClassify of texts) {
      const result = await classifier.forward(ai, { textToClassify }, { tracer })
    
      console.log('Text:', textToClassify)
      console.log('Classification:', result)
      console.log('---\n')
    }
  } finally {
    await provider.forceFlush()

    // wait for 3 seconds to ensure all traces are flushed
    console.log('Waiting for 3 seconds to ensure all traces are flushed...');
    await new Promise(resolve => setTimeout(resolve, 1000))

    await provider.shutdown();
    console.log('OpenTelemetry provider shut down.');
  }
}

main().catch(console.error) 