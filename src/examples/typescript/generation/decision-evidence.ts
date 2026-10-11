// ax-example:start
// title: TypeScript Decision Evidence Reranking
// group: generation
// description: Ranks documents through Ax signatures while retaining decision evidence and candidate IDs.
// provider: openai-decisions
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 46
// ax-example:end
import { ai, ax, f } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY.');
const model = ai({ name: 'openai-decisions', apiKey });
// Use name: 'typesafe' with a Typesafe key to run the same signature on Jev.
const judge = ax(
  f()
    .input('query', f.string())
    .input('document', f.string())
    .output('relevant', f.boolean().withEvidence({ threshold: 0.7 }))
    .output(
      'relevance',
      f
        .score(['Irrelevant', 'Related', 'Partial answer', 'Direct answer'])
        .withEvidence()
    )
    .build()
);
const query = 'How do I request a refund?';
const candidates = [
  {
    id: 'refund',
    text: 'Request a refund within 30 days through your account billing page.',
  },
  {
    id: 'password',
    text: 'Reset your password using the sign-in page.',
  },
];
const ranked = [];
for (const candidate of candidates) {
  const result = await judge.forward(model, {
    query,
    document: candidate.text,
  });
  ranked.push({ id: candidate.id, ...result });
}
ranked.sort((a, b) => b.relevance.value - a.relevance.value);
console.log(ranked);
