import {
  AxAIAnthropicModel,
  AxAIGoogleGeminiModel,
  AxAIOpenAIModel,
  AxBalancer,
  AxMultiServiceRouter,
  ai,
} from '@ax-llm/ax';

const apiKeys = {
  openai: process.env.OPENAI_APIKEY!,
  anthropic: process.env.ANTHROPIC_APIKEY!,
  google: process.env.GOOGLE_APIKEY!,
};

console.log('=== Type-Safe Multi-Service Router & Balancer Demo ===\n');

// Create AI services with specific model configurations
const openaiService = ai({
  name: 'openai',
  apiKey: apiKeys.openai,
  models: [
    {
      key: 'gpt-5.4',
      model: AxAIOpenAIModel.GPT54,
      description: 'GPT-5.4',
    },
    {
      key: 'gpt-5.4-mini',
      model: AxAIOpenAIModel.GPT54Mini,
      description: 'GPT-5.4 Mini',
    },
  ] as const,
});

const anthropicService = ai({
  name: 'anthropic',
  apiKey: apiKeys.anthropic,
  models: [
    {
      key: 'claude-sonnet-4-6',
      model: AxAIAnthropicModel.Claude46Sonnet,
      description: 'Claude Sonnet 4.6',
    },
    {
      key: 'claude-haiku-4-5',
      model: AxAIAnthropicModel.Claude45Haiku,
      description: 'Claude Haiku 4.5',
    },
  ] as const,
});

const googleService = ai({
  name: 'google-gemini',
  apiKey: apiKeys.google,
  models: [
    {
      key: 'gemini-3.5-flash',
      model: AxAIGoogleGeminiModel.Gemini35Flash,
      description: 'Gemini 3.5 Flash',
    },
    {
      key: 'gemini-3.1-flash-lite',
      model: AxAIGoogleGeminiModel.Gemini31FlashLite,
      description: 'Gemini 3.1 Flash Lite',
    },
  ] as const,
});

// Create type-safe multi-service router
// TModelKey is automatically inferred as: 'gpt-5.4' | 'gpt-5.4-mini' | 'claude-sonnet-4-6' | 'claude-haiku-4-5' | 'gemini-3.5-flash' | 'gemini-3.1-flash-lite'
const router = AxMultiServiceRouter.create([
  openaiService,
  anthropicService,
  googleService,
]);

// Create type-safe balancer (for services with same model keys)
// Let's create services with compatible models for balancing
const openaiBalanceService = ai({
  name: 'openai',
  apiKey: apiKeys.openai,
  models: [
    {
      key: 'smart-model',
      model: AxAIOpenAIModel.GPT54,
      description: 'Smart Model via OpenAI',
    },
    {
      key: 'fast-model',
      model: AxAIOpenAIModel.GPT54Mini,
      description: 'Fast Model via OpenAI',
    },
  ] as const,
});

const anthropicBalanceService = ai({
  name: 'anthropic',
  apiKey: apiKeys.anthropic,
  models: [
    {
      key: 'smart-model',
      model: AxAIAnthropicModel.Claude46Sonnet,
      description: 'Smart Model via Anthropic',
    },
    {
      key: 'fast-model',
      model: AxAIAnthropicModel.Claude45Haiku,
      description: 'Fast Model via Anthropic',
    },
  ] as const,
});

anthropicBalanceService.chat({
  chatPrompt: [{ role: 'user', content: 'Hello, world!' }],
  model: 'smart-model',
});

// These would now cause TypeScript compile errors:
// anthropicBalanceService.chat({ chatPrompt: [...], model: 'invalid-model' }); // ❌ Type error
// anthropicBalanceService.chat({ chatPrompt: [...], model: 'gpt-5.4' }); // ❌ Type error (not in this service's models)

// Create type-safe balancer
// TModelKey is automatically inferred as: 'smart-model' | 'fast-model'
const balancer = AxBalancer.create([
  openaiBalanceService,
  anthropicBalanceService,
]);

// Test router with type-safe model keys
console.log('🔀 Testing Multi-Service Router:');
console.log(
  'Available models:',
  router.getModelList().map((m) => m.key)
);

const routerResponse = await router.chat({
  chatPrompt: [{ role: 'user', content: 'Say hello in a creative way!' }],
  model: 'gpt-5.4',
});

// These would now cause TypeScript compile errors:
// await router.chat({ chatPrompt: [...], model: 'invalid-model' }); // ❌ Type error
// await router.chat({ chatPrompt: [...], model: 'smart-model' }); // ❌ Type error (not in router's models)

if (typeof routerResponse === 'object' && 'results' in routerResponse) {
  console.log('Router response:', routerResponse.results[0]?.content);
}

// Test balancer with type-safe model keys
console.log('\n⚖️ Testing Balancer:');
console.log(
  'Available models:',
  balancer.getModelList()?.map((m) => m.key)
);

const balancerResponse = await balancer.chat({
  chatPrompt: [{ role: 'user', content: 'Explain load balancing briefly' }],
  model: 'smart-model', // ✅ Type-safe: only valid model keys are allowed
});

// These would now cause TypeScript compile errors:
// await balancer.chat({ chatPrompt: [...], model: 'invalid-model' }); // ❌ Type error
// await balancer.chat({ chatPrompt: [...], model: 'gpt-5.4' }); // ❌ Type error (not in balancer's models)

if (typeof balancerResponse === 'object' && 'results' in balancerResponse) {
  console.log('Balancer response:', balancerResponse.results[0]?.content);
}

console.log('\n✅ Type-safe multi-service routing and balancing completed!');
console.log(
  '💡 Model keys are automatically inferred from service configurations'
);
console.log('🔒 TypeScript ensures only valid model keys can be used');
console.log(
  '🔧 Both .chat() method and AxGen.forward() now have type-safe model parameters'
);
