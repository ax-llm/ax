import { ai as createAI, flow } from '@ax-llm/ax';

// A whole AxFlow described as a mermaid flowchart. Node contracts live in
// %%ax comment directives (mermaid renderers ignore them), so this exact
// text also renders as a clean diagram. The extended signature grammar —
// constraint bags like string(max 500) and optional fields — keeps the
// diagram text-complete.
const WORKFLOW = `
flowchart TD
  %%ax summarize: documentText:string -> summaryText:string(max 500) "concise summary"
  %%ax check: summaryText:string -> verdict:class "pass, fail", note?:string
  %%ax format: summaryText:string, note?:string -> finalReport:string

  summarize[Summarize document] --> check{verdict}
  check -->|pass| format
  check -->|fail, max 3| summarize
`;

// Compile the diagram into a runnable flow. Inputs auto-wire by field name:
// check.summaryText binds to summarize's output, format.note to check's, and
// documentText (produced by no node) becomes the flow input.
const wf = flow.fromMermaid<{ documentText: string }, { finalReport: string }>(
  WORKFLOW
);

console.log('=== execution plan ===');
const plan = wf.getExecutionPlan();
console.log(
  `${plan.totalSteps} steps, ${plan.parallelGroups} groups, max parallelism ${plan.maxParallelism}`
);

console.log('\n=== inferred signature ===');
console.log(wf.getSignature().toString());

// Every flow renders back to the same dialect — round-trippable by design.
console.log('\n=== toMermaid() round-trip ===');
console.log(wf.toMermaid());

// The live part needs an API key; everything above runs without one.
if (process.env.OPENAI_APIKEY) {
  const llm = createAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY,
  });
  const result = await wf.forward(llm, {
    documentText:
      'Ax lets you build LLM programs from typed signatures instead of prompts. ' +
      'Signatures declare inputs and outputs; generators, agents and flows are ' +
      'compiled from them, and optimizers tune the prompts automatically.',
  });
  console.log('\n=== finalReport ===');
  console.log(result.finalReport);
} else {
  console.log('\nSet OPENAI_APIKEY to run the flow against a live model.');
}
