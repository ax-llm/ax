import { AxAI, AxAIOpenAIModel, AxGen, AxSignature, flow } from '@ax-llm/ax';
import { z } from 'zod';

const incidentInputSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe('Short description of the incident being triaged'),
  details: z
    .string()
    .min(10)
    .describe('Full report including any reproduction steps'),
  severity: z.enum(['low', 'medium', 'high']),
  tags: z
    .array(z.string())
    .optional()
    .describe('Optional labels shared with observability dashboards'),
});

const incidentOutputSchema = z.object({
  recommendedAction: z.enum(['escalate', 'monitor', 'close']),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  suggestedOwners: z.array(z.string()).optional(),
});

const { signature: incidentSignature, issues } = AxSignature.debugZodConversion(
  {
    description: 'Classify incoming incidents and propose a triage plan',
    input: incidentInputSchema,
    output: incidentOutputSchema,
  },
  {
    logger: (conversionIssues) => {
      if (conversionIssues.length === 0) {
        console.info('[zod-live-example] no downgrades detected');
      } else {
        console.warn('[zod-live-example] conversion issues', conversionIssues);
      }
    },
  }
);

type IncidentInput = z.input<typeof incidentInputSchema>;
type IncidentOutput = z.output<typeof incidentOutputSchema>;

const sampleIncident: IncidentInput = {
  summary: 'Spike in 500 errors on checkout service',
  details:
    'Multiple customers report failures when completing checkout. Error rate jumped to 7% in the last 10 minutes.',
  severity: 'high',
  tags: ['checkout', 'payments'],
};

function createOpenAIAI(): AxAI {
  const apiKey = process.env.OPENAI_APIKEY;

  if (!apiKey) {
    throw new Error(
      'Set OPENAI_APIKEY before running this example (export OPENAI_APIKEY=...)'
    );
  }

  return new AxAI({
    name: 'openai',
    apiKey,
    config: {
      model: AxAIOpenAIModel.GPT5Mini,
      maxTokens: 512,
    },
  });
}

async function runDirectExample(ai: AxAI): Promise<void> {
  const generator = new AxGen<IncidentInput, IncidentOutput>(
    incidentSignature,
    {
      description:
        'Triages incidents into actionable recommendations using Zod-derived signature',
    }
  );

  console.log('\n[zod-live-example] running AxGen.fromZod direct example...');

  const directResult = await generator.forward(ai, sampleIncident);

  console.log('[zod-live-example] direct result:');
  console.dir(directResult, { depth: null });
}

async function runFlowExample(ai: AxAI): Promise<void> {
  const triageFlow = flow<IncidentInput, IncidentOutput>()
    .node('triage', incidentSignature)
    .execute('triage', (state) => state)
    .map((state) => ({
      recommendedAction: state.triageResult.recommendedAction,
      priority: state.triageResult.priority,
      suggestedOwners: state.triageResult.suggestedOwners,
    }));

  console.log('\n[zod-live-example] running AxFlow + fromZod example...');

  const flowResult = await triageFlow.forward(ai, sampleIncident);

  console.log('[zod-live-example] flow result:');
  console.dir(flowResult, { depth: null });
}

async function main(): Promise<void> {
  console.log('[zod-live-example] ticket signature:');
  console.log(incidentSignature.toString());

  if (issues.length > 0) {
    console.warn('[zod-live-example] stored issues:', issues);
  }

  try {
    const ai = createOpenAIAI();
    await runDirectExample(ai);
    await runFlowExample(ai);
  } catch (error) {
    console.error('[zod-live-example] failed to run example:', error);
  }
}

void main();
