import { AxAIGoogleGeminiModel, AxJSRuntime, agent, ai } from '@ax-llm/ax';

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: {
    model: AxAIGoogleGeminiModel.Gemini35Flash,
  },
});

// The model can call final("message") when it needs no extra context object,
// or final("task", { context }) after gathering evidence. Both paths now go
// through the responder.
const createAgent = () =>
  agent(
    'query:string -> answer:string "A helpful assistant that answers questions"',
    {
      contextFields: [],
      runtime: new AxJSRuntime(),
      debug: true,
    }
  );

// Test 1: Simple greeting — final("message") still flows through the responder
console.log('=== Test 1: Simple greeting ===');
const greetingResult = await createAgent().forward(llm, {
  query: 'Hi, how are you?',
});
console.log('Responder answer:', greetingResult.answer);

// Test 2: Complex query — the model may use either final form, but the output
// still comes back through the same responder-backed path.
console.log('\n=== Test 2: Complex query ===');
const mathResult = await createAgent().forward(llm, {
  query: 'What is 17 * 23 + 45 * 12? Show your work.',
});
console.log('Responder answer:', mathResult.answer);
