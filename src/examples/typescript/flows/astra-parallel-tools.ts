// ax-example:start
// title: Astra parallel flow tools
// group: flows
// description: Run independent background lookups in separate flow conversations and join their results.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// ax-example:end
import { AxAIOpenAIModel, ai, ax, flow, fn } from '@ax-llm/ax';

const calls = { research: 0, inventory: 0 };
const research = fn('lookupResearch')
  .description('Get the research reference; call once.')
  .execution('background')
  .handler(async () => {
    calls.research++;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return 'RESEARCH-314';
  })
  .build();
const inventory = fn('lookupInventory')
  .description('Get the inventory reference; call once.')
  .execution('background')
  .handler(async () => {
    calls.inventory++;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return 'STOCK-271';
  })
  .build();
const workflow = flow<{ question: string }>()
  .node('research', ax('question -> answer', { functions: [research] }))
  .node('inventory', ax('question -> answer', { functions: [inventory] }))
  .execute('research', () => ({
    question: 'Call lookupResearch and report its exact reference.',
  }))
  .execute('inventory', () => ({
    question: 'Call lookupInventory and report its exact reference.',
  }))
  .returns((state) => ({
    references: {
      research: state.researchResult.answer,
      inventory: state.inventoryResult.answer,
    },
  }));

const result = await workflow.forward(
  ai({
    name: 'openai',
    apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY,
    config: { model: AxAIOpenAIModel.GPT6Astra, maxTokens: 1500 },
  }),
  { question: 'Get both references' },
  {
    thinkingTokenBudget: 'low',
    serviceTier: 'standard',
    abortSignal: AbortSignal.timeout(120_000),
  }
);
if (calls.research !== 1 || calls.inventory !== 1)
  throw new Error('Expected each lookup to execute once');
if (
  !result.references.research.includes('RESEARCH-314') ||
  !result.references.inventory.includes('STOCK-271')
)
  throw new Error('Flow omitted a tool result');
if (
  result.references.research.includes('STOCK-271') ||
  result.references.inventory.includes('RESEARCH-314')
)
  throw new Error('Parallel conversation results leaked across nodes');
console.log(result.references);
