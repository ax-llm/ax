import { AxSignature, ax } from '@ax-llm/ax';
import { z } from 'zod';

const bugReportInput = z.object({
  summary: z.string().describe('Short title for the issue'),
  details: z
    .string()
    .min(10)
    .describe('Long form description supplied by the reporter'),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  labels: z.array(z.enum(['ui', 'backend', 'api', 'docs'])).optional(),
  reportedAt: z.date(),
});

const bugReportOutput = z.object({
  triageSummary: z.string(),
  suggestedPriority: z.enum(['P0', 'P1', 'P2', 'P3']),
  requiresHotfix: z.boolean(),
});

const bugReportSignature = AxSignature.fromZod(
  {
    description: 'Classify user bug reports and propose a triage plan',
    input: bugReportInput,
    output: bugReportOutput,
  },
  {
    onIssues: (issues) => {
      if (issues.length > 0) {
        console.warn('[zod-signature-example] downgraded fields', issues);
      }
    },
  }
);

const triageAgent = ax(bugReportSignature);

async function main() {
  console.log('Bug report signature inputs:');
  console.table(bugReportSignature.getInputFields());

  console.log('\nBug report signature outputs:');
  console.table(bugReportSignature.getOutputFields());

  // In a real flow you would pass an AxAI instance here.
  // This example just shows the structure defined by the schema.
  const fakeReport = {
    summary: 'Checkout button unresponsive on mobile',
    details:
      'On iPhone 15 running iOS 18.1 the checkout button remains disabled even after filling the form.',
    severity: 'high' as const,
    labels: ['ui', 'api'] as const,
    reportedAt: new Date(),
  };

  console.log('\nSample request payload:');
  console.dir(fakeReport, { depth: null });

  // Normally: await triageAgent.forward(ai, fakeReport)
  console.log(
    '\nCall `forward` with an AxAI instance to run the classification.'
  );
}

void main();
