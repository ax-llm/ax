---
name: ax-typesafe
description: Use Typesafe Jev models with @ax-llm/ax in TypeScript. Covers boolean/class/rubric score signatures with decision evidence, value descriptions, provider trueThreshold, native Noul/Choice/Score questions, structured criteria, probability-based decisions, and explicit hybrid generation.
version: "25.3.2"
---

<!-- cspell:ignore noul -->

# Typesafe / Jev with Ax (TypeScript)

Use `name: 'typesafe'` for the Typesafe System One API. Jev is the model family;
`jev-latest` is the default model. Use the Ax exports below when integrating with
Ax. Python, Java, C++, Go, and Rust also support the adapter and native client.
Use their generated `ax-<language>-typesafe` skills for native syntax and types.

## Choose the Interface

| Need | Interface | Result |
|---|---|---|
| Required booleans and fixed classes | `ai({ name: 'typesafe', ... })` with `ax(...).forward()` | Ordinary signature-shaped values |
| Probabilities, confidence, and rubric scoring | `ax(...)` with evidence fields | Typed evidence in normal program results |
| Advanced structured criteria/state | `typesafe(...).systemOne(...)` | Native request features |
| Decisions followed by prose or tool use | A Typesafe decision step followed by a generative provider | Explicitly composed program results |

A `reply:string` output requests freeform text and is unsupported by Typesafe.
An output `team:class "support, billing"` returns one of those two strings.
Numbers, even with `min`/`max` bounds, do not define native scoring rubrics.


## Decision evidence and reranking

Use signature fields to access decision metadata with Jev, OpenAI Decisions,
or a generative provider:

```text
query:string, document:string ->
  relevant:boolean(evidence, threshold 0.7),
  category:class "support, billing"(evidence),
  relevance:score "Irrelevant, Related, Partial answer, Direct answer"(evidence)
```

Boolean evidence contains `value`, `probability`, `threshold`, and `provenance`.
Class evidence contains `value`, a complete label-to-probability map, and
`provenance`. Score evidence contains a continuous `value` from zero to the last
rubric index, ordered `levels`, ordered `probabilities`, and `provenance`.
Native class and score results can also contain the provider's `confidence`.
A score without `(evidence)` returns only its numeric value. Existing scalar
boolean and class fields keep their existing behavior.

Ax preserves a native provider's selected class, continuous score, probabilities,
and confidence. A native value can differ from the probability argmax or weighted
mean. With generative models, Ax requests probabilities, derives the boolean or
class locally, and calculates a score as the probability-weighted rubric index.
It preserves the supplied probabilities and never invents confidence.

`provenance.source` distinguishes `native` from `elicited`; `provider` and, when
available, `model` describe the actual response. These fields come from Ax, not
generated output. The common result shape does not make probabilities or
confidence equally calibrated across providers or models. Evaluate thresholds
and ranking quality on your own data. A score's meaning depends on its declared
rubric; it is not a probability of correctness.

For reranking, evaluate each query/document pair, retain the candidate ID in your
application, and sort by `relevance.value` within the same rubric and model.
Ordinary Ax processors, assertions, result selection, traces, and caches receive
the decoded result. Streaming waits for complete evidence before emitting it.

```typescript
const judge = ax(f().input('query', f.string()).input('document', f.string())
  .output('relevance', f.score(['Irrelevant', 'Related', 'Partial answer', 'Direct answer']).withEvidence())
  .build());
const result = await judge.forward(model, { query, document });
console.log(result.relevance.value, result.relevance.probabilities);
```

Use `boolean(evidence, refusal return)` (or an evidence field with `refusal return`)
to receive `{status: "answered", ...evidence}` or `{status: "refused", provenance}`.
By default, a refusal raises `AxDecisionRefusalError` and stops correction retries.

Generative providers support nested, optional, and array evidence fields. Native
Jev and OpenAI Decisions signatures require flat, required scalar fields; Ax
rejects unsupported shapes before transport. For advanced structured criteria
or native request features, the direct provider client remains available.
Label-only examples are accepted without manufactured distributions. Examples
containing actual evidence preserve it while omitting runtime-owned result metadata
from the inference demonstration.

## Boolean and Class Signatures

```typescript
import { ai, ax, f } from '@ax-llm/ax';

const apiKey = process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_APIKEY;
if (!apiKey) throw new Error('Set a Typesafe API key.');

const model = ai({ name: 'typesafe', apiKey, trueThreshold: 0.9 });
const triage = ax(`
  ticket:string ->
  urgent:boolean(
    true "Customers cannot complete a core task",
    false "A routine request or minor inconvenience"
  ) "Does this need immediate attention?",
  team:class "support, billing, engineering"(
    support "Product usage questions",
    billing "Individual invoice or charge disputes",
    engineering "Broken functionality or service outages"
  ) "Which team should investigate?"
`);

const decision = await triage.forward(model, {
  ticket: 'Checkout fails for every customer. Payments cannot complete.',
});
// decision.urgent: boolean
// decision.team: 'support' | 'billing' | 'engineering'
```

`trueThreshold` defaults to `0.5` and must be finite in `[0, 1]`. A boolean is
true when `noul >= trueThreshold`, including equality. This setting applies to
every boolean output on that provider instance. It is local conversion policy
and is never sent to Typesafe. Choice returns the selected label without an
automatic confidence cutoff or abstention.

Field names and descriptions become question instructions. Boolean value
descriptions become `criteria.true`/`criteria.false`; class descriptions become
criteria keyed by the exact class labels. Descriptions may be partial; class
labels without descriptions map to `null`. Duplicate/unknown keys and empty
descriptions fail validation. Quote class labels containing spaces or punctuation.
The fluent equivalent is `f.boolean(...).describeValues({ true: '...', false: '...' })`
or `f.class([...], ...).describeValues({ label: '...' })`.

The same signature works with conventional providers: Ax renders the base
description plus `value: description` lines in the prompt and JSON schema.
Annotations survive serialization and do not change inferred types or allowed
values. Use the [signature skill](https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-signature.md)
for the complete syntax. Declare ordered label rubrics with `score` fields.
Structured JSON criteria and custom numeric rubric entries use native requests
below, rather than encoded JSON inside a quoted description.

The adapter sends the normal Ax prompt as native state and batches the outputs
in one request. Required boolean/class/rubric score outputs are supported; optional, array,
nested, numeric, and freeform outputs fail before network access. Media, tools,
multiple completion samples, and generation controls such as `temperature` or
`maxTokens` are unsupported. There is no token streaming; Ax's
`streamingForward()` can deliver a completed result.

## Native Questions and Application Decisions

```typescript
import { typesafe } from '@ax-llm/ax';

const apiKey = process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_APIKEY;
if (!apiKey) throw new Error('Set a Typesafe API key.');

const client = typesafe({ apiKey });
const result = await client.systemOne({
  state: { ticket: 'Checkout fails for every customer.', recentEvents: [] },
  questions: {
    urgent: {
      type: 'noul',
      instructions: 'Does this require immediate incident response?',
      criteria: {
        true: { description: 'Core task blocked', examples: ['Cannot pay'] },
        false: 'Routine request or minor inconvenience',
      },
    },
    team: {
      type: 'choice',
      instructions: 'Which team should investigate?',
      criteria: {
        support: 'Product usage questions',
        engineering: 'Broken functionality or service outages',
      },
    },
    severity: {
      type: 'score',
      instructions: 'How severe is the customer impact?',
      criteria: ['Minor inconvenience', 'Feature impaired', 'Core task blocked'],
    },
  },
});

const escalate = result.answers.urgent.noul >= 0.9;
const team = result.answers.team.choice; // 'support' | 'engineering'
const severity = result.answers.severity.score; // May be fractional, from 0 to 2.
const severityOnTen = (severity / 2) * 10; // Explicit application scale.
const models = await client.listModels();
```

Keep inline questions or use `as const satisfies AxAITypesafeQuestions` for
reusable definitions so question keys and Choice labels retain their literal
types. Noul returns `noul` in `[0, 1]` and no separate confidence field. The
adapter's `trueThreshold` does not apply to the native client. Choice returns
`choice`, `probabilities`, and `confidence`; Score returns `score`,
`probabilities`, `legend`, and `confidence`. The response also includes `model`
and `usage.input_tokens`/`usage.output_tokens`.

Choice and Score probabilities must be finite values in `[0, 1]`, match the
criteria keys, and sum to one within an inclusive `0.01` tolerance. Totals of `0.99`
and `1.01` are accepted with an allowance for floating-point summation error.
Ax preserves the returned probabilities without renormalizing them.

Native state, instructions, and individual criteria accept text, JSON objects,
arrays, or `null`. Nested JSON may contain finite numbers and booleans; a bare
number or boolean is not a top-level entry. Instructions are optional in the
Ax/native types, but provide an explicit question: native question keys identify
answers and are not themselves instructions. Choice needs 1–255 labels; Score
needs 2–10 ordered levels. `null` leaves an outcome without a description.

For Jev question design:

- Phrase Noul as one clear yes/no judgment. A value near `0.5` expresses
  uncertainty about that judgment; use Score to measure a degree or severity.
- Give similar Choice labels distinct descriptions. Add a catch-all label only
  when it belongs in the application's allowed output set.
- Define one dimension per Score rubric. Preserve its fractional, zero-based
  position; choose rounding, normalization, and weighting explicitly in code.
- Evaluate independent questions together. A question cannot consume another
  answer from the same request; use a later call when that dependency exists.
- Test wording and decision thresholds against representative labeled inputs.
  Confidence describes the distribution and does not establish correctness.

These practices follow the provider's [Noul](https://docs.typesafe.ai/primitives/noul),
[Choice](https://docs.typesafe.ai/primitives/choice), and
[Score](https://docs.typesafe.ai/primitives/score) guidance. The
[official API types](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/types.ts)
describe native entries and response fields; Ax's transport configuration uses
the settings below.

## Models, Transport, and Diagnostics

| Setting | Signature provider | Native client |
|---|---|---|
| Default model override | `config: { model: 'jev-latest' }` | `model: 'jev-latest'` |
| Per-call model override | Third `forward()` argument: `{ model }` | `systemOne({ state, questions, model })` |
| Endpoint | `apiURL` (default `https://api.typesafe.ai`) | Same |
| Authentication | `apiKey` or `credentialProvider` | Same; optional static `headers` |
| Transport | `options.fetch`, `timeout`, `retry`, `abortSignal` | Same; methods accept a second transport-options argument, or the first for `listModels()` |

`listModels()` returns native model cards with `name`, `description`, and
`release_date`; it does not change Ax's configured model aliases. Renewable
credential callbacks receive `{ profile, operation, method, url }` on each
attempt: inference uses operation `chat`, discovery uses `models`. Native
instance and per-call cancellation signals both apply.

Context limits apply to the combined state, instructions, and criteria. Consult
the provider's [model documentation](https://docs.typesafe.ai/models) when choosing
input size. Ax neither silently truncates input nor claims an exact local token
count. Token usage is returned;
Ax does not assume token prices for these models.

For adapter calls, use `program.getUsage()` and `program.getChatLog()`.
Chat log entries retain `providerMetadata.typesafe.answers`; direct `.chat()`
responses retain the same metadata. Native calls return usage and full answers
directly. No separate generic metadata getter or alternate forward result is needed.

## Routing and Hybrid Workflows

Typesafe-only balancers preserve schema-required generation for scalar
signatures. Mixed pools retain their normal prompting; Typesafe is eligible
only when the actual request already includes a supported output schema.
Incompatible requests are excluded from selection and fallbacks even when
degradation is allowed. A bare chat request without a supported schema fails.

For prose, run a second `ax()` program with a generative provider and pass the
ticket plus the decision fields to it. Ax does not split a mixed
`urgent:boolean, reply:string` signature automatically. For agents that need
tools or code generation, use a generative actor and call Typesafe as a separate
decision step.

## Runnable Examples

Run from the repository root; the `tsx` command loads `.env`:

```bash
npm run tsx src/examples/typescript/generation/typesafe.ts
npm run tsx src/examples/typescript/generation/typesafe-native.ts
npm run tsx src/examples/typescript/generation/typesafe-hybrid.ts
npm run tsx src/examples/typescript/generation/value-descriptions.ts
```

The first two use `TYPESAFE_API_KEY` or `TYPESAFE_APIKEY`. The last two also use
`OPENAI_API_KEY` or `OPENAI_APIKEY`. The
[comparison example](https://github.com/ax-llm/ax/blob/main/src/examples/typescript/generation/value-descriptions.ts)
uses the same described signature with both providers. The
[native example](https://github.com/ax-llm/ax/blob/main/src/examples/typescript/generation/typesafe-native.ts)
covers all primitives and model discovery; the
[hybrid example](https://github.com/ax-llm/ax/blob/main/src/examples/typescript/generation/typesafe-hybrid.ts)
shows the two-program composition. Assert response contracts in live checks,
not exact model probabilities.
