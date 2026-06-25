// ax-example:start
// title: TypeScript Codebase Q&A with a Peek Context Map
// group: long-agents
// description: Answers several dependency questions over one large module index by building and reusing an evolving context map (the "peek" orientation cache), so later questions skip re-scanning the corpus.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 20
// ax-example:end
import {
  AxAgentContextMap,
  AxAIGoogleGeminiModel,
  AxJSRuntime,
  agent,
  ai,
} from '@ax-llm/ax';

const apiKey = process.env.GOOGLE_APIKEY;
if (!apiKey) {
  throw new Error('Set GOOGLE_APIKEY to run this example.');
}

const llm = ai({
  name: 'google-gemini',
  apiKey,
  config: {
    model: AxAIGoogleGeminiModel.Gemini35Flash,
  },
});

// ---------------------------------------------------------------------------
// A large module-dependency index for a monorepo. Each block is a record the
// agent must *search* to answer — the answers cannot be guessed, only computed
// by filtering the index. Generated large so it would not fit comfortably in a
// prompt; it lives in contextFields and is queried from the runtime.
// ---------------------------------------------------------------------------
type ModuleRecord = { path: string; imports: string[]; writes: string };

function buildModuleIndex(): ModuleRecord[] {
  const core: ModuleRecord[] = [
    {
      path: 'packages/api/middleware/auth.ts',
      imports: ['packages/shared'],
      writes: '-',
    },
    {
      path: 'packages/api/middleware/rateLimit.ts',
      imports: ['packages/db'],
      writes: '-',
    },
    {
      path: 'packages/api/routes/checkout.ts',
      imports: [
        'packages/api/middleware/auth.ts',
        'packages/services/orders/createOrder.ts',
        'packages/services/payments/charge.ts',
      ],
      writes: '-',
    },
    {
      path: 'packages/api/routes/search.ts',
      imports: [
        'packages/api/middleware/auth.ts',
        'packages/services/catalog/searchCatalog.ts',
      ],
      writes: '-',
    },
    {
      path: 'packages/services/orders/createOrder.ts',
      imports: ['packages/db', 'packages/clients/bus'],
      writes: 'orders',
    },
    {
      path: 'packages/services/orders/orderRepo.ts',
      imports: ['packages/db'],
      writes: 'orders',
    },
    {
      path: 'packages/services/payments/charge.ts',
      imports: ['packages/clients/acquirer', 'packages/db'],
      writes: 'payments',
    },
    {
      path: 'packages/services/payments/refund.ts',
      imports: ['packages/clients/acquirer', 'packages/db'],
      writes: 'refunds',
    },
    {
      path: 'packages/services/catalog/searchCatalog.ts',
      imports: ['packages/db'],
      writes: '-',
    },
    {
      path: 'packages/clients/acquirer/index.ts',
      imports: ['packages/shared'],
      writes: '-',
    },
    {
      path: 'packages/clients/bus/index.ts',
      imports: ['packages/shared'],
      writes: '-',
    },
  ];
  // Filler modules so the index is genuinely large; some also depend on the acquirer.
  const filler: ModuleRecord[] = [];
  for (let i = 0; i < 110; i++) {
    filler.push({
      path: `packages/services/feature${i}/handler.ts`,
      imports: [
        i % 4 === 0 ? 'packages/clients/acquirer' : 'packages/db',
        'packages/shared',
      ],
      writes: i % 6 === 0 ? 'audit' : '-',
    });
  }
  return [...core, ...filler];
}

const modules = buildModuleIndex();
const codebaseIndex = modules
  .map(
    (m) =>
      `PATH: ${m.path}\nIMPORTS: ${m.imports.join(', ')}\nWRITES: ${m.writes}`
  )
  .join('\n\n');
console.log(
  `Module index: ${modules.length} records (kept out of the prompt).`
);

// The map is small and persistable. evolveSteps: 1 lets the first query refine
// it; later queries reuse it as compact orientation instead of re-deriving it.
const map = new AxAgentContextMap(undefined, {
  maxChars: 1_800,
  infiniteEvolve: false,
  evolveSteps: 1,
});

const analyst = agent(
  'context:string, question:string -> answer:string, paths:string[] "Exact PATH values from the index that answer the question"',
  {
    runtime: new AxJSRuntime(),
    contextFields: ['context'],
    contextPolicy: {
      preset: 'adaptive',
      budget: 'balanced',
    },
    contextOptions: {
      description:
        'The context is a module index of "PATH / IMPORTS / WRITES" records. Answer by filtering those records in code — never guess. Return exact PATH values verbatim.',
    },
    contextMap: {
      map,
      onUpdate: ({ map: updatedMap }) => {
        console.log(`\n[context map updated]\n${updatedMap.text}`);
      },
    },
    maxTurns: 24,
  }
);

const questions = [
  "Which modules import 'packages/clients/acquirer'? Give the exact PATH values.",
  "Which modules write to the 'orders' table?",
  'What are the direct IMPORTS of packages/api/routes/checkout.ts?',
];

for (const question of questions) {
  const result = await analyst.forward(llm, {
    context: codebaseIndex,
    question,
  });
  console.log('\nQ:', question);
  console.log('A:', result.answer);
  console.log('Paths:', (result.paths ?? []).join(', '));
}

console.log('\nPersist this context-map snapshot between runs:');
console.log(JSON.stringify(map.snapshot(), null, 2));
