// ax-example:start
// title: TypeScript Incident Log Forensics (RLM)
// group: long-agents
// description: Infers service architecture and root-cause findings from a huge CloudWatch export that never enters the prompt — held in contextFields and worked through the runtime under a lean contextPolicy.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 10
// ax-example:end
import { AxAIGoogleGeminiModel, AxJSRuntime, agent, ai } from '@ax-llm/ax';

const apiKey = process.env.GOOGLE_APIKEY;
if (!apiKey) {
  throw new Error('Set GOOGLE_APIKEY to run this example.');
}

const llm = ai({
  name: 'google-gemini',
  apiKey,
  config: {
    model: AxAIGoogleGeminiModel.Gemini3Flash,
  },
});

// ---------------------------------------------------------------------------
// Synthetic CloudWatch-style export — generated large on purpose. Dumping these
// raw events into a prompt would blow the context window. The agent keeps them
// in its runtime (contextFields) and only the *evidence it extracts* ever
// reaches the model. Deterministic so the example is reproducible.
// ---------------------------------------------------------------------------
type LogEvent = {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  service: string;
  requestId: string;
  statusCode?: number;
  latencyMs?: number;
  tenantTier?: 'free' | 'growth' | 'enterprise';
  message: string;
};

function buildLogDump(): LogEvent[] {
  const start = Date.parse('2026-03-02T13:00:00Z');
  const events: LogEvent[] = [];
  const push = (i: number, e: Omit<LogEvent, 'timestamp' | 'requestId'>) => {
    events.push({
      timestamp: new Date(start + i * 2000).toISOString(),
      requestId: `req-${100000 + i}`,
      ...e,
    });
  };

  for (let i = 0; i < 1600; i++) {
    // Routine, healthy traffic across the fleet.
    push(i, {
      level: 'INFO',
      service: 'gateway',
      statusCode: 200,
      latencyMs: 40 + (i % 30),
      message: 'route ok GET /checkout',
    });
    push(i, {
      level: 'INFO',
      service: 'search-api',
      statusCode: 200,
      latencyMs: 70 + (i % 50),
      message: 'query ok q=shoes',
    });

    // Window A (payments cascade): upstream timeouts in payments-gw spill into
    // checkout-api 502s for enterprise tenants, with retry storms + pool exhaustion.
    if (i >= 300 && i < 520) {
      push(i, {
        level: 'ERROR',
        service: 'payments-gw',
        statusCode: 504,
        latencyMs: 10000,
        tenantTier: 'enterprise',
        message: 'upstream timeout calling acquirer (10s)',
      });
      push(i, {
        level: 'ERROR',
        service: 'checkout-api',
        statusCode: 502,
        tenantTier: 'enterprise',
        message: 'bad gateway from svc-payments-gw',
      });
      if (i % 3 === 0) {
        push(i, {
          level: 'WARN',
          service: 'payments-gw',
          message: 'connection pool exhausted (max=64) waiting=200+',
        });
        push(i, {
          level: 'WARN',
          service: 'checkout-api',
          tenantTier: 'enterprise',
          message: 'user-visible: "Payment could not be processed"',
        });
      }
    }

    // Window B (search throttling): the nightly catalog-cron pins CPU and
    // search-api starts returning 429s.
    if (i >= 1000 && i < 1120) {
      push(i, {
        level: 'WARN',
        service: 'catalog-cron',
        latencyMs: 0,
        message: 'rebuild step pinning CPU at 95% on shared node',
      });
      push(i, {
        level: 'ERROR',
        service: 'search-api',
        statusCode: 429,
        message: 'rate limited: downstream catalog unavailable',
      });
    }
  }

  return events;
}

const logs = buildLogDump();
console.log(`Generated ${logs.length} log events (kept out of the prompt).`);

const logRLM = agent(
  'task:string, logs:json "Raw CloudWatch export; keep this out of the prompt" -> architecture:string[] "Services and how they call each other", findings:json[] "Each: issue, count, window, evidence, impact", overallHealth:string, nextActions:string[]',
  {
    runtime: new AxJSRuntime(),
    // The export stays in the runtime; only extracted evidence reaches the model.
    contextFields: ['logs'],
    contextPolicy: {
      preset: 'lean',
      budget: 'balanced',
    },
    maxTurns: 24,
    // Cap how much runtime output is echoed back into the action log per turn.
    maxRuntimeChars: 12_000,
    // Watch the actor work through the export.
    agentStatusCallback: (message, status) => {
      console.log(`[${status}] ${message}`);
    },
  }
);

const report = await logRLM.forward(llm, {
  logs,
  task: 'Infer the service architecture from the logs alone. Then find repeated errors, throttles, retries, and bad user states — with the affected time window, an occurrence count, and concrete log evidence for each.',
});

console.log('\n=== Report ===');
console.log(JSON.stringify(report, null, 2));

// Staged usage breaks token spend into the context (distiller) stage vs the
// task (executor + responder) stage — useful for costing long-context runs.
console.log('\n=== Staged usage ===');
console.log(JSON.stringify(logRLM.getStagedUsage(), null, 2));
