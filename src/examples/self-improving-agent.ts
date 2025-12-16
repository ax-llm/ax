import {
  AxAIGoogleGeminiModel,
  type AxGen,
  type AxCheckpoint,
  AxLearn,
  type AxStorage,
  type AxTrace,
  ai,
  ax,
} from '@ax-llm/ax';

// Helper to create in-memory storage for examples
// in production you would use a database
const createStorage = (): AxStorage => {
  const traces = new Map<string, AxTrace[]>();
  const checkpoints = new Map<string, AxCheckpoint[]>();

  return {
    save: async (name: string, item: AxTrace | AxCheckpoint) => {
      if (item.type === 'trace') {
        const list = traces.get(name) ?? [];
        const index = list.findIndex((t) => t.id === item.id);
        if (index >= 0) list[index] = { ...list[index], ...item };
        else list.push({ ...item });
        traces.set(name, list);
      } else {
        const list = checkpoints.get(name) ?? [];
        const index = list.findIndex((c) => c.version === item.version);
        if (index >= 0) list[index] = { ...list[index], ...item };
        else list.push({ ...item });
        // Keep sorted by version desc
        list.sort((a, b) => b.version - a.version);
        checkpoints.set(name, list);
      }
    },
    load: async (name: string, query) => {
      if (query.type === 'trace') {
        let list = traces.get(name) ?? [];
        if (query.limit) list = list.slice(0, query.limit);
        return list;
      }
      let list = checkpoints.get(name) ?? [];
      if (query.limit) list = list.slice(0, query.limit);
      return list;
    },
  };
};

async function main() {
  console.log('AxLearn: Self-Improving Agents Demo');
  console.log('===================================');

  // Create the AI services - big model for teacher, small for student
  const teacherLlm = ai({
    name: 'google-gemini',
    apiKey: process.env.GOOGLE_APIKEY as string,
    config: { model: AxAIGoogleGeminiModel.Gemini25Pro },
  });

  const llm = ai({
    name: 'google-gemini',
    apiKey: process.env.GOOGLE_APIKEY as string,
    config: { model: AxAIGoogleGeminiModel.Gemini25FlashLite },
  });

  const gen = ax(
    'customerName, query, history -> supportResponse, sentiment'
  ) as AxGen<
    { customerName: string; query: string; history: string },
    { supportResponse: string; sentiment: 'positive' | 'neutral' | 'negative' }
  >;

  gen.setInstruction(
    'You are a helpful customer support agent. Respond politely and check sentiment.'
  );

  // Create self-improving agent with built-in optimization config
  // "Set it up once"
  const agent = new AxLearn(gen, {
    name: 'support-bot-v2',
    teacher: teacherLlm,
    storage: createStorage(),
    budget: 5,
    generateExamples: false, // Disable synthetic generation, use manual examples
    // Provide seed examples for optimization
    examples: [
      {
        customerName: 'Alice Smith',
        query: 'When will my package arrive?',
        history: 'Order #12345 placed 3 days ago',
        supportResponse:
          'Hi Alice! Based on your order #12345, your package is currently in transit and should arrive within 2-3 business days. You can track it using the link in your confirmation email.',
        sentiment: 'neutral',
      },
      {
        customerName: 'Bob Jones',
        query: 'This product is broken! I want my money back!',
        history: 'Purchased laptop 2 weeks ago',
        supportResponse:
          "I'm really sorry to hear about this, Bob. That must be frustrating. I'd be happy to help you with a refund or replacement. Could you describe what's wrong with the laptop so we can resolve this quickly?",
        sentiment: 'negative',
      },
      {
        customerName: 'Carol White',
        query: 'Thank you so much for the quick delivery!',
        history: 'Order delivered yesterday',
        supportResponse:
          "You're welcome, Carol! We're thrilled you received your order so quickly. Thank you for your kind words - it means a lot to our team! Is there anything else I can help you with?",
        sentiment: 'positive',
      },
    ],
  });

  // 1. Use in production (auto-tracing)
  console.log('--- Production Usage ---');
  const result1 = await agent.forward(llm, {
    customerName: 'John Doe',
    query: 'Where is my order?',
    history: 'Session started',
  });
  console.log(`Input: Where is my order?`);
  console.log(`Response: ${result1.supportResponse}\n`);

  // 2. Optimize
  // Uses the configuration from constructor (teacher, budget, etc.)
  console.log('--- Optimization Loop ---');
  console.log('Starting optimization...');

  const optResult = await agent.optimize({
    // Optional overrides if needed
  });

  console.log(`\nFinal Score: ${optResult.score.toFixed(2)}`);
  console.log(`Training examples: ${optResult.stats.trainingExamples}`);
  console.log(`Versions saved: ${optResult.checkpointVersion}`);

  // 3. Use improved version
  console.log('\n--- Improved Agent Usage ---');
  const result2 = await agent.forward(llm, {
    customerName: 'John Doe',
    query: 'I want a refund immediately!',
    history: 'Session started',
  });
  console.log(`Input: I want a refund immediately!`);
  console.log(`Response: ${result2.supportResponse}`);
}

main().catch(console.error);
