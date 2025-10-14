# Agentic Context Engineering (ACE) Prompts

ACE mirrors the paper’s generator → reflector → curator loop using `ax(...)` programs under the hood.
Here’s how each component is wired today, and where to customize prompts if you need to override the defaults.

## Generator

ACE uses the program you pass into `optimizer.compile(...)` as the Generator. You own the signature and the base
system instruction—ACE simply appends the evolving playbook when it calls `forward`. For example, the bundled
incident triage demo builds this signature:

```ts
const generatorSig = f()
  .input('ticket', f.string('Concise incident summary'))
  .input('impact', f.string('Observed customer or business impact'))
  .input('scope', f.string('Reported scope of the issue'))
  .input('signals', f.string('Supporting telemetry or operational signals'))
  .output('severity', f.class(['low', 'medium', 'high'], 'Incident severity label'))
  .output('reasoning', f.string('Brief rationale referencing internal incident policy'))
  .build();

const generator = ax(generatorSig);
generator.setDescription(`You are doing first-pass incident triage ...`);
```

At compile-time ACE stitches the playbook beneath whatever instruction you provide.

## Reflector

The reflector program is generated lazily inside `AxACE`. Its schema is:

```ts
const reflector = ax(
  `
  question:string "Original task input serialized as JSON",
  generator_answer:string "Generator output serialized as JSON",
  generator_reasoning?:string "Generator reasoning trace",
  playbook:string "Current context playbook rendered as markdown",
  expected_answer?:string "Expected output when ground truth is available",
  feedback?:string "External feedback or reward signal",
  previous_reflection?:string "Most recent reflection JSON when running multi-round refinement" ->
  reasoning:string "Step-by-step analysis of generator performance",
  errorIdentification:string "Specific mistakes detected",
  rootCauseAnalysis:string "Underlying cause of the error",
  correctApproach:string "What the generator should do differently",
  keyInsight:string "Reusable insight to remember",
  bulletTags:json "Array of {id, tag} entries referencing playbook bullets"
  `,
);
```

By default Ax synthesizes a prompt from this signature. If you want to drop in the Appendix‑D reflector prompt from the
paper, grab the underlying generator and override its description before running `compile`:

```ts
const optimizer = new AxACE({ studentAI, teacherAI });
const reflector = (optimizer as any).getOrCreateReflectorProgram?.call(optimizer);
reflector?.setDescription(myReflectorPrompt);
```

## Curator

The curator schema tracks the paper’s delta-output contract:

```ts
const curator = ax(
  `
  playbook:string "Current playbook serialized as JSON",
  reflection:string "Latest reflection output serialized as JSON",
  question_context:string "Original task input serialized as JSON",
  token_budget?:number "Approximate token budget for curator response" ->
  reasoning:string "Justification for the proposed updates",
  operations:json "List of operations with type/section/content fields"
  `,
);
```

Override it the same way:

```ts
const curator = (optimizer as any).getOrCreateCuratorProgram?.call(optimizer);
curator?.setDescription(myCuratorPrompt);
```

## Where to Hook In

Until helper setters land, reaching the underlying programs through the internal
`getOrCreateReflectorProgram` / `getOrCreateCuratorProgram` methods (as shown above) is the supported path.

---

📌 **Tip:** the reflector and curator signatures live in `src/ax/dsp/optimizers/ace.ts`. Search for `getOrCreateReflectorProgram`
and `getOrCreateCuratorProgram` if you need to track future changes.
