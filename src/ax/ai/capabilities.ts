import type { AxAIService, AxChatRequest } from './types.js';
import type { MediaRequirements } from './processor.js';

/**
 * Represents a provider's compatibility score for a specific request
 */
export interface ProviderCapabilityScore {
  /** The AI service provider */
  provider: AxAIService;
  /** Numerical score based on capability match (higher is better) */
  score: number;
  /** List of capabilities the provider is missing for this request */
  missingCapabilities: string[];
  /** List of capabilities the provider supports for this request */
  supportedCapabilities: string[];
}

/**
 * Result of validating whether a provider can handle a request
 */
export interface CapabilityValidationResult {
  /** Whether the provider fully supports the request */
  isSupported: boolean;
  /** List of capabilities the provider is missing */
  missingCapabilities: string[];
  /** Non-critical issues or limitations */
  warnings: string[];
  /** Suggested alternatives for missing capabilities */
  alternatives: string[];
}

/**
 * Analyzes a chat request to determine what capabilities it requires from AI providers.
 *
 * This function examines the request content to identify:
 * - Media types (images, audio, files, URLs)
 * - Function calling requirements
 * - Streaming requirements
 * - Caching requirements
 * - Token usage estimation
 *
 * @param request - The chat request to analyze
 * @returns Object containing detailed capability requirements and token estimation
 *
 * @example
 * ```typescript
 * const requirements = axAnalyzeRequestRequirements({
 *   chatPrompt: [{
 *     role: 'user',
 *     content: [
 *       { type: 'text', text: 'Analyze this image:' },
 *       { type: 'image', image: 'base64...', details: 'high' }
 *     ]
 *   }]
 * });
 *
 * console.log(requirements.hasImages); // true
 * console.log(requirements.estimatedTokens); // ~95
 * ```
 */
export function axAnalyzeRequestRequirements(
  request: AxChatRequest
): MediaRequirements & {
  requiresFunctions: boolean;
  requiresStreaming: boolean;
  requiresCaching: boolean;
  contentTypes: Set<string>;
  estimatedTokens: number;
} {
  let hasImages = false;
  let hasAudio = false;
  let hasFiles = false;
  let hasUrls = false;
  let requiresFunctions = false;
  let requiresStreaming = false;
  let requiresCaching = false;
  const contentTypes = new Set<string>();
  let estimatedTokens = 0;

  // Analyze chat prompt content
  if (request.chatPrompt && Array.isArray(request.chatPrompt)) {
    for (const message of request.chatPrompt) {
      if (message.role === 'user' && Array.isArray(message.content)) {
        for (const part of message.content) {
          contentTypes.add(part.type);

          switch (part.type) {
            case 'image':
              hasImages = true;
              if (part.cache) requiresCaching = true;
              // Estimate ~85 tokens per image (OpenAI's default)
              estimatedTokens += 85;
              break;
            case 'audio':
              hasAudio = true;
              if (part.cache) requiresCaching = true;
              // Estimate based on duration (rough: 1 token per second)
              estimatedTokens += part.duration || 60;
              break;
            case 'file':
              hasFiles = true;
              if (part.cache) requiresCaching = true;
              // Estimate based on extracted text length
              estimatedTokens += Math.ceil(
                (part.extractedText?.length || 1000) / 4
              );
              break;
            case 'url':
              hasUrls = true;
              if (part.cache) requiresCaching = true;
              // Estimate based on cached content length
              estimatedTokens += Math.ceil(
                (part.cachedContent?.length || 2000) / 4
              );
              break;
            case 'text':
              if (part.cache) requiresCaching = true;
              // Standard token estimation: ~4 characters per token
              estimatedTokens += Math.ceil(part.text.length / 4);
              break;
          }
        }
      } else if ('content' in message && typeof message.content === 'string') {
        estimatedTokens += Math.ceil(message.content.length / 4);
      }

      if ('cache' in message && message.cache) requiresCaching = true;
    }
  }

  // Check for function requirements
  if (request.functions && request.functions.length > 0) {
    requiresFunctions = true;
  }

  // Check for streaming requirements
  if (request.modelConfig?.stream === true) {
    requiresStreaming = true;
  }

  // Check capability preferences
  if (request.capabilities) {
    if (request.capabilities.requiresImages) hasImages = true;
    if (request.capabilities.requiresAudio) hasAudio = true;
    if (request.capabilities.requiresFiles) hasFiles = true;
    if (request.capabilities.requiresWebSearch) hasUrls = true;
  }

  return {
    hasImages,
    hasAudio,
    hasFiles,
    hasUrls,
    requiresFunctions,
    requiresStreaming,
    requiresCaching,
    contentTypes,
    estimatedTokens,
  };
}

/**
 * Validates whether an AI provider can handle a request with specific requirements.
 *
 * Compares the provider's feature set against the analyzed request requirements
 * to determine compatibility, missing capabilities, and potential issues.
 *
 * @param provider - The AI service provider to validate
 * @param requirements - Requirements object from axAnalyzeRequestRequirements()
 * @returns Validation result with support status, missing capabilities, and alternatives
 *
 * @example
 * ```typescript
 * const requirements = axAnalyzeRequestRequirements(request);
 * const validation = axValidateProviderCapabilities(openaiProvider, requirements);
 *
 * if (!validation.isSupported) {
 *   console.log('Missing:', validation.missingCapabilities);
 *   console.log('Try:', validation.alternatives);
 * }
 * ```
 */
export function axValidateProviderCapabilities(
  provider: AxAIService,
  requirements: ReturnType<typeof axAnalyzeRequestRequirements>
): CapabilityValidationResult {
  const features = provider.getFeatures();
  const missingCapabilities: string[] = [];
  const warnings: string[] = [];
  const alternatives: string[] = [];

  // Check media capabilities
  if (requirements.hasImages && !features.media.images.supported) {
    missingCapabilities.push('Image support');
    alternatives.push('Use altText for images or imageToText service');
  }

  if (requirements.hasAudio && !features.media.audio.supported) {
    missingCapabilities.push('Audio support');
    alternatives.push('Pre-transcribe audio or use transcription field');
  }

  if (requirements.hasFiles && !features.media.files.supported) {
    missingCapabilities.push('File support');
    alternatives.push('Pre-extract text content or use extractedText field');
  }

  if (requirements.hasUrls && !features.media.urls.supported) {
    missingCapabilities.push('URL/Web search support');
    alternatives.push('Pre-fetch content or use cachedContent field');
  }

  // Check function capabilities
  if (requirements.requiresFunctions && !features.functions) {
    missingCapabilities.push('Function calling');
  }

  // Check streaming capabilities
  if (requirements.requiresStreaming && !features.streaming) {
    missingCapabilities.push('Streaming responses');
    alternatives.push('Use non-streaming mode');
  }

  // Check caching capabilities
  if (requirements.requiresCaching && !features.caching.supported) {
    missingCapabilities.push('Content caching');
    alternatives.push('Repeated content will not be cached');
  }

  // Add warnings for potential issues
  if (requirements.hasImages && features.media.images.supported) {
    const maxSize = features.media.images.maxSize;
    if (maxSize && maxSize < 10 * 1024 * 1024) {
      // Less than 10MB
      warnings.push(
        `Image size limit is ${Math.round(maxSize / (1024 * 1024))}MB`
      );
    }
  }

  if (requirements.hasAudio && features.media.audio.supported) {
    const maxDuration = features.media.audio.maxDuration;
    if (maxDuration && maxDuration < 600) {
      // Less than 10 minutes
      warnings.push(
        `Audio duration limit is ${Math.round(maxDuration / 60)} minutes`
      );
    }
  }

  const isSupported = missingCapabilities.length === 0;

  return {
    isSupported,
    missingCapabilities,
    warnings,
    alternatives,
  };
}

/**
 * Scores multiple AI providers based on how well they meet request requirements.
 *
 * Uses a weighted scoring system where providers earn points for supported capabilities:
 * - Base functionality: +10 points
 * - Media support (images/audio/files/URLs): +25 points each
 * - Core features (functions/streaming/caching): +8-15 points each
 * - Missing critical capabilities: -10 points each
 * - Bonus points for advanced features (large file support, persistent caching, etc.)
 *
 * @param providers - Array of AI service providers to score
 * @param requirements - Requirements object from axAnalyzeRequestRequirements()
 * @returns Array of scored providers sorted by score (highest first)
 *
 * @example
 * ```typescript
 * const requirements = axAnalyzeRequestRequirements(request);
 * const scores = axScoreProvidersForRequest([openai, gemini, cohere], requirements);
 *
 * console.log(`Best: ${scores[0].provider.getName()} (${scores[0].score} points)`);
 * console.log(`Supports: ${scores[0].supportedCapabilities.join(', ')}`);
 * ```
 */
export function axScoreProvidersForRequest(
  providers: AxAIService[],
  requirements: ReturnType<typeof axAnalyzeRequestRequirements>
): ProviderCapabilityScore[] {
  return providers
    .map((provider) => {
      const features = provider.getFeatures();
      const validation = axValidateProviderCapabilities(provider, requirements);

      let score = 0;
      const supportedCapabilities: string[] = [];

      // Base score for being a functioning provider
      score += 10;

      // Media support scoring (high weight)
      if (requirements.hasImages) {
        if (features.media.images.supported) {
          score += 25;
          supportedCapabilities.push('Images');

          // Bonus for better image capabilities
          if (features.media.images.detailLevels?.includes('high')) {
            score += 5;
          }
          if (
            features.media.images.maxSize &&
            features.media.images.maxSize > 10 * 1024 * 1024
          ) {
            score += 3; // Large image support
          }
        }
      }

      if (requirements.hasAudio) {
        if (features.media.audio.supported) {
          score += 25;
          supportedCapabilities.push('Audio');

          // Bonus for longer audio support
          if (
            features.media.audio.maxDuration &&
            features.media.audio.maxDuration > 600
          ) {
            score += 5;
          }
        }
      }

      if (requirements.hasFiles) {
        if (features.media.files.supported) {
          score += 25;
          supportedCapabilities.push('Files');

          // Bonus for different upload methods
          if (features.media.files.uploadMethod === 'cloud') {
            score += 3;
          }
        }
      }

      if (requirements.hasUrls) {
        if (features.media.urls.supported) {
          score += 25;
          supportedCapabilities.push('URLs');

          // Bonus for web search
          if (features.media.urls.webSearch) {
            score += 5;
          }
        }
      }

      // Core capability scoring (medium weight)
      if (requirements.requiresFunctions) {
        if (features.functions) {
          score += 15;
          supportedCapabilities.push('Functions');

          // Bonus for chain-of-thought with functions
          if (features.functionCot) {
            score += 3;
          }
        }
      }

      if (requirements.requiresStreaming) {
        if (features.streaming) {
          score += 10;
          supportedCapabilities.push('Streaming');
        }
      }

      if (requirements.requiresCaching) {
        if (features.caching.supported) {
          score += 8;
          supportedCapabilities.push('Caching');

          // Bonus for persistent caching
          if (features.caching.types.includes('persistent')) {
            score += 3;
          }
        }
      }

      // Additional capability bonuses (low weight)
      if (features.thinking) {
        score += 2;
      }

      if (features.multiTurn) {
        score += 2;
      }

      if (features.hasThinkingBudget) {
        score += 1;
      }

      if (features.hasShowThoughts) {
        score += 1;
      }

      // Penalty for missing critical capabilities
      score -= validation.missingCapabilities.length * 10;

      return {
        provider,
        score,
        missingCapabilities: validation.missingCapabilities,
        supportedCapabilities,
      };
    })
    .sort((a, b) => b.score - a.score); // Sort by score descending
}

/**
 * Automatically selects the optimal AI provider for a given request.
 *
 * Analyzes the request requirements, scores available providers, and returns
 * the best match based on capability compatibility and scoring algorithm.
 *
 * @param request - The chat request to find a provider for
 * @param availableProviders - Array of available AI service providers
 * @param options - Selection options
 * @param options.requireExactMatch - Only return providers with full capability support
 * @param options.allowDegradation - Allow providers that require content processing fallbacks
 * @returns The optimal AI service provider
 * @throws Error if no suitable provider found or requirements not met
 *
 * @example
 * ```typescript
 * // Automatic selection with degradation allowed
 * const provider = axSelectOptimalProvider(
 *   multiModalRequest,
 *   [openai, gemini, cohere],
 *   { allowDegradation: true }
 * );
 *
 * // Strict matching - must support all features natively
 * const provider = axSelectOptimalProvider(
 *   imageRequest,
 *   [openai, gemini],
 *   { requireExactMatch: true }
 * );
 * ```
 */
export function axSelectOptimalProvider(
  request: AxChatRequest,
  availableProviders: AxAIService[],
  options: {
    requireExactMatch?: boolean;
    allowDegradation?: boolean;
  } = {}
): AxAIService {
  if (availableProviders.length === 0) {
    throw new Error('No providers available');
  }

  const requirements = axAnalyzeRequestRequirements(request);
  const scoredProviders = axScoreProvidersForRequest(
    availableProviders,
    requirements
  );

  if (options.requireExactMatch) {
    // Only consider providers that fully support all requirements
    const fullyCompatible = scoredProviders.filter(
      (p) => p.missingCapabilities.length === 0
    );
    if (fullyCompatible.length === 0) {
      throw new Error(
        `No providers fully support the request requirements: ${
          scoredProviders[0]?.missingCapabilities.join(', ') ||
          'unknown requirements'
        }`
      );
    }
    return fullyCompatible[0].provider;
  }

  if (!options.allowDegradation) {
    // Check if the best provider is missing critical capabilities
    const bestProvider = scoredProviders[0];
    if (bestProvider.missingCapabilities.length > 0) {
      throw new Error(
        `Best available provider (${bestProvider.provider.getName()}) is missing: ${bestProvider.missingCapabilities.join(
          ', '
        )}`
      );
    }
  }

  return scoredProviders[0].provider;
}

/**
 * Generates a comprehensive compatibility report for a request across all providers.
 *
 * Provides detailed analysis including requirement breakdown, provider scoring,
 * recommendations, and human-readable compatibility summary.
 *
 * @param request - The chat request to analyze
 * @param availableProviders - Array of available AI service providers
 * @returns Comprehensive compatibility report with analysis and recommendations
 *
 * @example
 * ```typescript
 * const report = axGetCompatibilityReport(request, [openai, gemini, cohere]);
 *
 * console.log(report.summary); // "OpenAI supports 4/4 requirements (100% compatibility)"
 * console.log('Requirements:', report.requirements);
 *
 * for (const score of report.providerScores) {
 *   console.log(`${score.provider.getName()}: ${score.score} points`);
 *   console.log(`  Missing: ${score.missingCapabilities.join(', ')}`);
 * }
 * ```
 */
export function axGetCompatibilityReport(
  request: AxChatRequest,
  availableProviders: AxAIService[]
): {
  requirements: ReturnType<typeof axAnalyzeRequestRequirements>;
  providerScores: ProviderCapabilityScore[];
  recommendedProvider: AxAIService | null;
  summary: string;
} {
  const requirements = axAnalyzeRequestRequirements(request);
  const providerScores = axScoreProvidersForRequest(
    availableProviders,
    requirements
  );

  const recommendedProvider = providerScores[0]?.provider || null;

  const totalRequirements = [
    requirements.hasImages && 'images',
    requirements.hasAudio && 'audio',
    requirements.hasFiles && 'files',
    requirements.hasUrls && 'URLs',
    requirements.requiresFunctions && 'functions',
    requirements.requiresStreaming && 'streaming',
    requirements.requiresCaching && 'caching',
  ].filter(Boolean).length;

  const supportedRequirements = recommendedProvider
    ? providerScores[0].supportedCapabilities.length
    : 0;

  const summary = recommendedProvider
    ? `${recommendedProvider.getName()} supports ${supportedRequirements}/${totalRequirements} requirements (${Math.round(
        (supportedRequirements / Math.max(totalRequirements, 1)) * 100
      )}% compatibility)`
    : 'No suitable providers found';

  return {
    requirements,
    providerScores,
    recommendedProvider,
    summary,
  };
}

/**
 * Filters providers that support a specific media type.
 *
 * @param providers - Array of AI service providers to filter
 * @param mediaType - The media type to check support for
 * @returns Array of providers that support the specified media type
 *
 * @example
 * ```typescript
 * const imageProviders = axGetProvidersWithMediaSupport(allProviders, 'images');
 * console.log(`${imageProviders.length} providers support images`);
 * ```
 */
export function axGetProvidersWithMediaSupport(
  providers: AxAIService[],
  mediaType: 'images' | 'audio' | 'files' | 'urls'
): AxAIService[] {
  return providers.filter((provider) => {
    const features = provider.getFeatures();
    return features.media[mediaType].supported;
  });
}

/**
 * Analyzes format compatibility across providers for a specific media type.
 *
 * @param providers - Array of AI service providers to analyze
 * @param mediaType - The media type to check format support for
 * @returns Object mapping each supported format to the providers that support it
 *
 * @example
 * ```typescript
 * const compatibility = axGetFormatCompatibility(allProviders, 'images');
 * console.log('JPEG support:', compatibility['image/jpeg']?.map(p => p.getName()));
 * console.log('PNG support:', compatibility['image/png']?.map(p => p.getName()));
 * ```
 */
export function axGetFormatCompatibility(
  providers: AxAIService[],
  mediaType: 'images' | 'audio' | 'files'
): {
  [format: string]: AxAIService[];
} {
  const compatibility: { [format: string]: AxAIService[] } = {};

  for (const provider of providers) {
    const features = provider.getFeatures();
    const mediaFeatures = features.media[mediaType];

    if (mediaFeatures.supported) {
      for (const format of mediaFeatures.formats) {
        if (!compatibility[format]) {
          compatibility[format] = [];
        }
        compatibility[format].push(provider);
      }
    }
  }

  return compatibility;
}
