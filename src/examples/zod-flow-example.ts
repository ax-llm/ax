import { AxMockAIService, AxSignature, flow } from '@ax-llm/ax';
import { z } from 'zod';

const ticketInputSchema = z.object({
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
    .array(z.string().optional())
    .describe('Optional labels shared with observability dashboards'),
});

const ticketOutputSchema = z.object({
  recommendedAction: z.enum(['escalate', 'monitor', 'close']),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  suggestedOwners: z.array(z.string()).optional(),
});

const { signature: ticketSignature, issues } = AxSignature.debugZodConversion(
  {
    description: 'Classify incoming incidents and propose a triage plan',
    input: ticketInputSchema,
    output: ticketOutputSchema,
  },
  {
    logger: (conversionIssues) => {
      if (conversionIssues.length === 0) {
        console.info('[zod-flow-example] no downgrades detected');
      } else {
        console.warn(
          '[zod-flow-example] zod conversion issues',
          conversionIssues
        );
      }
    },
  }
);

type TicketInput = z.input<typeof ticketInputSchema>;
type TicketOutput = z.output<typeof ticketOutputSchema>;

const triageFlow = flow<TicketInput, TicketOutput>()
  .node('triage', ticketSignature)
  .execute('triage', (state) => state)
  .map((state) => ({
    recommendedAction: state.triageResult.recommendedAction,
    priority: state.triageResult.priority,
    suggestedOwners: state.triageResult.suggestedOwners,
  }));

const mockAI = new AxMockAIService({
  chatResponse: async () => ({
    results: [
      {
        index: 0,
        content:
          'Recommended Action: escalate\nPriority: P1\nSuggested Owners: ["incident-response","platform-oncall"]',
        finishReason: 'stop',
      },
    ],
    modelUsage: {
      ai: 'mock',
      model: 'zod-flow-mock',
      tokens: { promptTokens: 42, completionTokens: 58, totalTokens: 100 },
    },
  }),
});

const sampleTicket: TicketInput = {
  summary: 'Spike in 500s on checkout service',
  details:
    'Multiple customers report failures when completing checkout. Error rate jumped to 7% in the last 10 minutes.',
  severity: 'high',
  tags: ['checkout', 'payments'],
};

async function main() {
  console.log('[zod-flow-example] ticket signature:', ticketSignature.toString());
  if (issues.length > 0) {
    console.warn('[zod-flow-example] stored issues:', issues);
  }

  const result = await triageFlow.forward(mockAI, sampleTicket);

  console.log('[zod-flow-example] triage result:');
  console.dir(result, { depth: null });
}

void main();
