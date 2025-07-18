import {
  AxAI,
  AxAIAnthropicModel,
  AxAIGoogleGeminiModel,
  AxAIOpenAIModel,
  AxBalancer,
  AxMultiServiceRouter,
} from '@ax-llm/ax';

const apiKeys = {
  openai: process.env.OPENAI_APIKEY!,
  anthropic: process.env.ANTHROPIC_APIKEY!,
  google: process.env.GOOGLE_APIKEY!,
};

console.log('=== Type-Safe Multi-Service Router & Balancer Demo ===\n');

// Create AI services with specific model configurations
const openaiService = AxAI.create({
  name: 'openai',
  apiKey: apiKeys.openai,
  models: [
    {
      key: 'gpt-4o',
      model: AxAIOpenAIModel.GPT4O,
      description: 'GPT-4 Optimized',
    },
    {
      key: 'gpt-4o-mini',
      model: AxAIOpenAIModel.GPT4OMini,
      description: 'GPT-4 Mini',
    },
  ] as const,
});

const anthropicService = AxAI.create({
  name: 'anthropic',
  apiKey: apiKeys.anthropic,
  models: [
    {
      key: 'claude-3-5-sonnet',
      model: AxAIAnthropicModel.Claude35Sonnet,
      description: 'Claude 3.5 Sonnet',
    },
    {
      key: 'claude-3-5-haiku',
      model: AxAIAnthropicModel.Claude35Haiku,
      description: 'Claude 3.5 Haiku',
    },
  ] as const,
});

const googleService = AxAI.create({
  name: 'google-gemini',
  apiKey: apiKeys.google,
  models: [
    {
      key: 'gemini-2-flash',
      model: AxAIGoogleGeminiModel.Gemini20Flash,
      description: 'Gemini 2.0 Flash',
    },
    {
      key: 'gemini-1-5-pro',
      model: AxAIGoogleGeminiModel.Gemini15Pro,
      description: 'Gemini 1.5 Pro',
    },
  ] as const,
});

// Create type-safe multi-service router
// TModelKey is automatically inferred as: 'gpt-4o' | 'gpt-4o-mini' | 'claude-3-5-sonnet' | 'claude-3-5-haiku' | 'gemini-2-flash' | 'gemini-1-5-pro'
const router = AxMultiServiceRouter.create([
  openaiService,
  anthropicService,
  googleService,
]);

// Create type-safe balancer (for services with same model keys)
// Let's create services with compatible models for balancing
const openaiBalanceService = AxAI.create({
  name: 'openai',
  apiKey: apiKeys.openai,
  models: [
    {
      key: 'smart-model',
      model: AxAIOpenAIModel.GPT4O,
      description: 'Smart Model via OpenAI',
    },
    {
      key: 'fast-model',
      model: AxAIOpenAIModel.GPT4OMini,
      description: 'Fast Model via OpenAI',
    },
  ] as const,
});

const anthropicBalanceService = AxAI.create({
  name: 'anthropic',
  apiKey: apiKeys.anthropic,
  models: [
    {
      key: 'smart-model',
      model: AxAIAnthropicModel.Claude35Sonnet,
      description: 'Smart Model via Anthropic',
    },
    {
      key: 'fast-model',
      model: AxAIAnthropicModel.Claude35Haiku,
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
// anthropicBalanceService.chat({ chatPrompt: [...], model: 'gpt-4o' }); // ❌ Type error (not in this service's models)

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
  model: 'gpt-4o',
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
// await balancer.chat({ chatPrompt: [...], model: 'gpt-4o' }); // ❌ Type error (not in balancer's models)

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
