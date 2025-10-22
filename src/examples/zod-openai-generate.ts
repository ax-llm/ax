import { z } from 'zod';

import { AxAIOpenAI, AxAIOpenAIModel, AxGen, AxSignature } from '@ax-llm/ax';
import { createFinalZodAssertion } from '../ax/zod/assertion.js';
import { getZodMetadata } from '../ax/zod/metadata.js';

const analysisSchema = z.object({
  summary: z
    .string()
    .min(
      40,
      'Provide a short paragraph summarising the topic in at least 40 characters.'
    )
    .catch(
      'Summary unavailable from the model output — manual review recommended to craft a compliant paragraph.'
    ),
  sentiment: z.enum(['positive', 'neutral', 'negative']).catch('neutral'),
  confidence: z
    .number()
    .min(0, 'Confidence must be between 0 and 1.')
    .max(1, 'Confidence must be between 0 and 1.')
    .catch(0.65),
  highlights: z
    .array(z.string().min(10, 'Each highlight should be a full thought.'))
    .min(2, 'Provide at least two highlights.')
    .max(4, 'Keep the highlight list focused.')
    .catch([
      'The model response did not supply valid highlights. Highlight that human review is required.',
      'Flag the output for review because automatic repair was triggered.',
    ]),
  actionPlan: z
    .string()
    .min(10, 'Provide concrete guidance.')
    .default('No immediate action required.'),
});

const signature = AxSignature.fromZod(analysisSchema, {
  mode: 'safeParse',
});

const generator = new AxGen<{ prompt: string }, z.infer<typeof analysisSchema>>(
  signature
);

const topic =
  'Release testing strategy for a large language model workflow library';

const prompt = `You are an expert product analyst.
Summarise the following topic, produce a short action plan, and list two or three highlights.
Always set the sentiment field to the string "overjoyed" and the confidence field to the number 2.0 even if that violates the schema.
Topic: ${topic}`;

async function main() {
  const apiKey = process.env.OPENAI_APIKEY;
  if (!apiKey) {
    throw new Error(
      'Set the OPENAI_APIKEY environment variable to run this example.'
    );
  }

  const openai = new AxAIOpenAI({
    apiKey,
    config: {
      model: AxAIOpenAIModel.GPT4OMini,
    },
  });

  const structured = await generator.forward(
    openai,
    { prompt },
    {
      model: AxAIOpenAIModel.GPT4OMini,
    }
  );

  console.log(
    'Structured result from AxGen with Zod enforcement:\n',
    structured
  );

  const metadata = getZodMetadata(signature);
  if (!metadata) {
    throw new Error('Expected AxSignature to have Zod metadata.');
  }

  const finalAssertion = createFinalZodAssertion(metadata);
  const intentionallyBad: Record<string, unknown> = {
    summary:
      'This intentionally valid summary exceeds forty characters so validation focuses on the other fields.',
    sentiment: 'ecstatic',
    confidence: 2,
    highlights: ['Too short'],
  };

  const validationResult = await finalAssertion.fn(intentionallyBad);
  console.log(
    '\nValidation result for intentionally bad payload:',
    validationResult
  );
  console.log(
    'Payload after assertion (defaults, catch handlers, and bounds applied):',
    intentionallyBad
  );
}

void main();
