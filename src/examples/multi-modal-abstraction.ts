/**
 * Multi-Modal AI Abstraction Example
 *
 * This example demonstrates the new enhanced AxChatRequest capabilities:
 * - Extended content types (images, audio, files, URLs)
 * - Provider capability detection and routing
 * - Graceful degradation for unsupported content types
 * - Content processing and transformation
 */

import {
  axGetCompatibilityReport,
  axSelectOptimalProvider,
} from '../ax/ai/capabilities.js';
import { AxMockAIService } from '../ax/ai/mock/api.js';
import { axProcessContentForProvider } from '../ax/ai/processor.js';
import { AxProviderRouter } from '../ax/ai/router.js';
import type { AxChatRequest } from '../ax/ai/types.js';

// Example: Multi-modal request with images, audio, files, and URLs
const multiModalRequest: AxChatRequest = {
  chatPrompt: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Please analyze the following multi-modal content:',
        },
        {
          type: 'image',
          mimeType: 'image/jpeg',
          image: 'base64-encoded-image-data...',
          details: 'high',
          altText: 'A chart showing quarterly sales data',
          optimize: 'quality',
        },
        {
          type: 'audio',
          data: 'base64-encoded-audio-data...',
          format: 'wav',
          duration: 45,
          transcription: 'The speaker mentions increasing market share by 15%',
        },
        {
          type: 'file',
          data: 'base64-encoded-pdf-data...',
          filename: 'quarterly-report.pdf',
          mimeType: 'application/pdf',
          extractedText: 'Q3 Results: Revenue increased 23% year-over-year...',
        },
        {
          type: 'url',
          url: 'https://example.com/market-analysis',
          title: 'Market Analysis Report',
          cachedContent:
            'The market shows strong growth trends in technology sector...',
        },
      ],
    },
  ],
  capabilities: {
    requiresImages: true,
    requiresAudio: true,
    fallbackBehavior: 'degrade',
  },
  processing: {
    imageCompression: true,
    audioTranscription: true,
    fileTextExtraction: true,
    urlContentFetching: true,
  },
};

// Create mock provider with full media capabilities (simulating OpenAI/GPT-4V)
class MockFullMediaProvider extends AxMockAIService<string> {
  getFeatures() {
    return {
      functions: true,
      streaming: true,
      media: {
        images: {
          supported: true,
          formats: ['image/jpeg', 'image/png', 'image/gif'],
          maxSize: 20 * 1024 * 1024,
          detailLevels: ['high', 'low', 'auto'] as ('high' | 'low' | 'auto')[],
        },
        audio: {
          supported: true,
          formats: ['wav', 'mp3'],
          maxDuration: 25 * 60,
        },
        files: {
          supported: true,
          formats: ['text/plain', 'application/pdf'],
          maxSize: 512 * 1024 * 1024,
          uploadMethod: 'upload' as const,
        },
        urls: {
          supported: true,
          webSearch: true,
          contextFetching: true,
        },
      },
      caching: {
        supported: false,
        types: [] as ('ephemeral' | 'persistent')[],
      },
      thinking: false,
      multiTurn: true,
    };
  }
}

// Create mock provider with partial capabilities (simulating Gemini)
class MockPartialMediaProvider extends AxMockAIService<string> {
  getFeatures() {
    return {
      functions: true,
      streaming: true,
      media: {
        images: {
          supported: true,
          formats: ['image/jpeg', 'image/png'],
          maxSize: 10 * 1024 * 1024,
          detailLevels: ['auto'] as ('high' | 'low' | 'auto')[],
        },
        audio: {
          supported: false,
          formats: [],
        },
        files: {
          supported: false,
          formats: [],
          uploadMethod: 'none' as const,
        },
        urls: {
          supported: true,
          webSearch: true,
          contextFetching: true,
        },
      },
      caching: {
        supported: true,
        types: ['ephemeral'] as ('ephemeral' | 'persistent')[],
      },
      thinking: false,
      multiTurn: true,
    };
  }
}

// Setup multiple AI providers (using mock providers to demonstrate the abstraction)
const openaiProvider = new MockFullMediaProvider({
  name: 'OpenAI-Mock',
  modelInfo: { name: 'gpt-4o' },
  chatResponse: {
    results: [
      {
        index: 0,
        content: 'Mock OpenAI response analyzing multi-modal content',
      },
    ],
  },
});

const geminiProvider = new MockPartialMediaProvider({
  name: 'Gemini-Mock',
  modelInfo: { name: 'gemini-pro-vision' },
  chatResponse: {
    results: [
      { index: 0, content: 'Mock Gemini response with vision capabilities' },
    ],
  },
});

const anthropicProvider = new AxMockAIService<string>({
  name: 'Anthropic-Mock',
  modelInfo: { name: 'claude-3-sonnet' },
  features: { functions: true, streaming: true },
  chatResponse: {
    results: [{ index: 0, content: 'Mock Anthropic response with analysis' }],
  },
});

const cohereProvider = new AxMockAIService<string>({
  name: 'Cohere-Mock',
  modelInfo: { name: 'command-r-plus' },
  features: { functions: false, streaming: false },
  chatResponse: {
    results: [{ index: 0, content: 'Mock Cohere text-only response' }],
  },
});

const availableProviders = [
  openaiProvider,
  geminiProvider,
  anthropicProvider,
  cohereProvider,
];

console.log('=== Multi-Modal AI Abstraction Demo ===\n');

// 1. Analyze provider compatibility
console.log('1. Provider Compatibility Analysis:');
const compatibilityReport = axGetCompatibilityReport(
  multiModalRequest,
  availableProviders
);

console.log(`Requirements detected:`);
console.log(`- Images: ${compatibilityReport.requirements.hasImages}`);
console.log(`- Audio: ${compatibilityReport.requirements.hasAudio}`);
console.log(`- Files: ${compatibilityReport.requirements.hasFiles}`);
console.log(`- URLs: ${compatibilityReport.requirements.hasUrls}`);
console.log(
  `- Functions: ${compatibilityReport.requirements.requiresFunctions}`
);
console.log(
  `- Estimated tokens: ${compatibilityReport.requirements.estimatedTokens}\n`
);

console.log('Provider Scores:');
for (const score of compatibilityReport.providerScores) {
  console.log(`${score.provider.getName()}: ${score.score} points`);
  console.log(
    `  Supported: ${score.supportedCapabilities.join(', ') || 'Basic functionality'}`
  );
  console.log(`  Missing: ${score.missingCapabilities.join(', ') || 'None'}`);
}

console.log(`\nRecommended: ${compatibilityReport.summary}\n`);

// 2. Demonstrate optimal provider selection
console.log('2. Optimal Provider Selection:');
const optimalProvider = axSelectOptimalProvider(
  multiModalRequest,
  availableProviders
);
console.log(`Selected provider: ${optimalProvider.getName()}`);

const features = optimalProvider.getFeatures();
console.log('Provider capabilities:');
console.log(
  `  Images: ${features.media.images.supported} (formats: ${features.media.images.formats.join(', ')})`
);
console.log(
  `  Audio: ${features.media.audio.supported} (formats: ${features.media.audio.formats.join(', ')})`
);
console.log(
  `  Files: ${features.media.files.supported} (method: ${features.media.files.uploadMethod})`
);
console.log(
  `  URLs: ${features.media.urls.supported} (web search: ${features.media.urls.webSearch})`
);
console.log(
  `  Caching: ${features.caching.supported} (types: ${features.caching.types.join(', ')})\n`
);

// 3. Demonstrate content processing for different providers
console.log('3. Content Processing Examples:');

// Process for text-only provider (Mock Cohere)
console.log('Processing for text-only provider (Mock Cohere):');
try {
  const cohereContent = await axProcessContentForProvider(
    (multiModalRequest.chatPrompt[0] as any).content,
    cohereProvider,
    {
      fallbackBehavior: 'degrade',
      // Simulate processing services
      imageToText: async (_imageData: string) =>
        'AI Vision: Chart showing quarterly sales with 23% growth',
      audioToText: async (_audioData: string) =>
        'Transcription: The speaker mentions increasing market share by 15%',
      fileToText: async (_fileData: string, _mimeType: string) =>
        'PDF Extract: Q3 Results show 23% revenue increase',
      urlToText: async (_url: string) =>
        'Web Content: Market analysis shows strong tech sector growth',
    }
  );

  console.log('Processed content (first 200 chars):');
  for (const item of cohereContent.slice(0, 3)) {
    console.log(`  "${item.text.substring(0, 100)}..."`);
  }
} catch (error) {
  console.log(
    `Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
  );
}

console.log('\n4. Multi-Provider Router with Graceful Degradation:');

// Setup router with processing services
const router = new AxProviderRouter({
  providers: {
    primary: optimalProvider,
    alternatives: availableProviders.filter((p) => p !== optimalProvider),
  },
  routing: {
    preferenceOrder: ['capability', 'quality'],
    capability: {
      requireExactMatch: false,
      allowDegradation: true,
    },
  },
  processing: {
    imageToText: async (_imageData: string) => {
      console.log('  🔄 Converting image to text description...');
      return 'AI Vision Analysis: A professional chart displaying quarterly sales data with clear upward trends, showing a 23% increase in revenue compared to the previous quarter.';
    },
    audioToText: async (_audioData: string, format?: string) => {
      console.log(`  🔄 Transcribing ${format} audio...`);
      return 'Audio Transcription: The speaker discusses market performance, highlighting a 15% increase in market share and expressing optimism about future growth prospects.';
    },
    fileToText: async (_fileData: string, mimeType: string) => {
      console.log(`  🔄 Extracting text from ${mimeType} file...`);
      return 'Document Summary: Q3 financial report showing strong performance with 23% year-over-year revenue growth, increased market penetration, and positive outlook for Q4.';
    },
    urlToText: async (url: string) => {
      console.log(`  🔄 Fetching content from ${url}...`);
      return 'Web Article Summary: Comprehensive market analysis reveals robust growth trends in the technology sector, with emerging opportunities in AI and cloud computing driving significant market expansion.';
    },
  },
});

// Get routing recommendation
const recommendation = await router.getRoutingRecommendation(multiModalRequest);
console.log(`Routing recommendation:`);
console.log(`  Provider: ${recommendation.provider.getName()}`);
console.log(
  `  Processing applied: ${recommendation.processingApplied.join(', ') || 'None'}`
);
console.log(
  `  Degradations: ${recommendation.degradations.join(', ') || 'None'}`
);
console.log(`  Warnings: ${recommendation.warnings.join(', ') || 'None'}`);

// Validate request
const validation = await router.validateRequest(multiModalRequest);
console.log(`\nRequest validation:`);
console.log(`  Can handle: ${validation.canHandle}`);
console.log(`  Issues: ${validation.issues.join(', ') || 'None'}`);
console.log(
  `  Recommendations: ${validation.recommendations.join(', ') || 'None'}`
);

// Get routing stats
const stats = router.getRoutingStats();
console.log(`\nRouting statistics:`);
console.log(`  Total providers: ${stats.totalProviders}`);
console.log(`  Capability matrix:`);
for (const [capability, providers] of Object.entries(stats.capabilityMatrix)) {
  console.log(`    ${capability}: ${(providers as string[]).join(', ')}`);
}

console.log('\n5. Execute Multi-Modal Request with Graceful Degradation:');
console.log('(Skipped in demo to avoid API calls)');

// In a real implementation, you would execute:
// const result = await router.chat(multiModalRequest, {
//   processingOptions: { fallbackBehavior: 'degrade' },
//   routingOptions: { allowDegradation: true },
// });

console.log('✅ This would execute the request with the selected provider');
console.log(`📊 Provider would be: ${optimalProvider.getName()}`);
console.log('🔄 Content would be processed based on provider capabilities');
console.log('📱 Response would be returned with routing metadata');

console.log('\n=== Demo Complete ===');
console.log('\nKey Features Demonstrated:');
console.log(
  '✅ Extended AxChatRequest with file, URL, and enhanced media support'
);
console.log('✅ Provider capability detection and scoring');
console.log('✅ Intelligent provider selection based on requirements');
console.log('✅ Content processing and transformation for unsupported types');
console.log('✅ Graceful degradation with fallback mechanisms');
console.log('✅ Multi-provider routing with error recovery');
console.log('✅ Comprehensive validation and recommendation system');
