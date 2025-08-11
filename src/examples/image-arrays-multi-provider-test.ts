import { ai, ax } from '@ax-llm/ax';

// Test image with multiple providers
const imageAnalyzer = ax(`
  images:image[] "Multiple images to analyze" ->
  descriptions:string[] "Description for each image",
  commonThemes:string[] "Common themes across all images"
`);

// Sample base64 images (real ones)
const sampleImages = [
  {
    mimeType: 'image/jpeg',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==', // 1x1 pixel JPEG
  },
  {
    mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', // 1x1 pixel PNG
  },
];

const providers = [
  {
    name: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    config: { model: 'gpt-5-mini' },
  },
  {
    name: 'google-gemini',
    apiKey: process.env.GEMINI_API_KEY,
    config: { model: 'gemini-2.5-flash' },
  },
  {
    name: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    config: { model: 'claude-sonnet-4-20250514' },
  },
  {
    name: 'openrouter',
    apiKey: process.env.OPENROUTER_API_KEY,
    config: { model: 'openai/gpt-5-mini' },
  },
];

async function testImageArraysWithProviders() {
  console.log('🧪 Testing Image Arrays Across Multiple Providers\n');

  const results = [];

  for (const provider of providers) {
    if (!provider.apiKey) {
      console.log(`⚠️  Skipping ${provider.name} - no API key`);
      continue;
    }

    console.log(`🔄 Testing ${provider.name}...`);

    try {
      const llm = ai({
        name: provider.name as any,
        apiKey: provider.apiKey,
        config: provider.config,
      });

      const result = await imageAnalyzer.forward(llm, {
        images: sampleImages,
      });

      console.log(`✅ ${provider.name}:`);
      console.log(
        `   Descriptions: ${result.descriptions[0]?.substring(0, 100)}...`
      );
      console.log(`   Themes: ${result.commonThemes.join(', ')}`);

      results.push({
        provider: provider.name,
        success: true,
        descriptions: result.descriptions,
        themes: result.commonThemes,
      });
    } catch (error) {
      console.log(`❌ ${provider.name}: ${(error as Error).message}`);
      results.push({
        provider: provider.name,
        success: false,
        error: (error as Error).message,
      });
    }

    console.log('');
  }

  console.log('📊 Summary:');
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);

  if (successful.length > 0) {
    console.log('\n🎉 Image arrays work with these providers:');
    successful.forEach((r) => console.log(`   - ${r.provider}`));
  }

  if (failed.length > 0) {
    console.log('\n⚠️  Issues with these providers:');
    failed.forEach((r) => console.log(`   - ${r.provider}: ${r.error}`));
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testImageArraysWithProviders().catch(console.error);
}
