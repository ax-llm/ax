import type {
  AxAIService,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
} from './types.js';
import {
  axProcessContentForProvider,
  type ProcessingOptions,
} from './processor.js';
import {
  axSelectOptimalProvider,
  axAnalyzeRequestRequirements,
} from './capabilities.js';
import { AxMediaNotSupportedError } from '../util/apicall.js';

/**
 * Services for converting unsupported content types to text or optimized formats
 */
export interface AxContentProcessingServices {
  /** Service to convert images to text descriptions */
  imageToText?: (imageData: string) => Promise<string>;
  /** Service to convert audio to text transcriptions */
  audioToText?: (audioData: string, format?: string) => Promise<string>;
  /** Service to extract text from files */
  fileToText?: (fileData: string, mimeType: string) => Promise<string>;
  /** Service to fetch and extract text from URLs */
  urlToText?: (url: string) => Promise<string>;
  /** Service to optimize images for size/quality */
  imageOptimization?: (
    imageData: string,
    options: OptimizationOptions
  ) => Promise<string>;
}

/**
 * Options for image optimization processing
 */
export interface OptimizationOptions {
  /** Image quality (0-100) */
  quality?: number;
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Target image format */
  format?: 'jpeg' | 'png' | 'webp';
}

/**
 * Configuration for multi-provider routing with fallback capabilities
 */
export interface AxMultiProviderConfig {
  /** Provider hierarchy for routing */
  providers: {
    /** Primary provider to try first */
    primary: AxAIService;
    /** Alternative providers for fallback */
    alternatives: AxAIService[];
  };
  /** Routing behavior configuration */
  routing: {
    /** Order of preferences when selecting providers */
    preferenceOrder: ('capability' | 'cost' | 'speed' | 'quality')[];
    /** Capability matching requirements */
    capability: {
      /** Only use providers with full capability support */
      requireExactMatch: boolean;
      /** Allow providers that require content processing fallbacks */
      allowDegradation: boolean;
    };
  };
  /** Content processing services for unsupported media types */
  processing: AxContentProcessingServices;
}

/**
 * Result of the routing process including provider selection and processing information
 */
export interface AxRoutingResult {
  /** The selected AI service provider */
  provider: AxAIService;
  /** List of content processing steps that were applied */
  processingApplied: string[];
  /** List of capability degradations that occurred */
  degradations: string[];
  /** Non-critical warnings about the routing decision */
  warnings: string[];
}

/**
 * Multi-provider router that automatically selects optimal AI providers and handles content processing.
 *
 * The router analyzes requests to determine capability requirements, scores available providers,
 * and automatically handles content transformation for unsupported media types. It provides
 * graceful degradation and fallback mechanisms for robust multi-modal AI applications.
 *
 * @example
 * ```typescript
 * const router = new AxProviderRouter({
 *   providers: {
 *     primary: openaiProvider,
 *     alternatives: [geminiProvider, cohereProvider]
 *   },
 *   routing: {
 *     preferenceOrder: ['capability', 'quality'],
 *     capability: {
 *       requireExactMatch: false,
 *       allowDegradation: true
 *     }
 *   },
 *   processing: {
 *     imageToText: async (data) => await visionService.describe(data),
 *     audioToText: async (data) => await speechService.transcribe(data)
 *   }
 * });
 *
 * const result = await router.chat(multiModalRequest);
 * console.log(`Used: ${result.routing.provider.getName()}`);
 * ```
 */
export class AxProviderRouter {
  private providers: AxAIService[];
  private processingServices: AxContentProcessingServices;
  private config: AxMultiProviderConfig['routing'];

  /**
   * Creates a new provider router with the specified configuration.
   *
   * @param config - Router configuration including providers, routing preferences, and processing services
   */
  constructor(config: AxMultiProviderConfig) {
    this.providers = [
      config.providers.primary,
      ...config.providers.alternatives,
    ];
    this.processingServices = config.processing;
    this.config = config.routing;
  }

  /**
   * Routes a chat request to the most appropriate provider with automatic content processing.
   *
   * This method analyzes the request, selects the optimal provider, preprocesses content
   * for compatibility, and executes the request with fallback support.
   *
   * @param request - The chat request to process
   * @param options - Extended options including fallback providers and routing preferences
   * @param options.fallbackProviders - Additional providers to try if primary selection fails
   * @param options.processingOptions - Content processing options and conversion services
   * @param options.routingOptions - Provider selection and routing behavior options
   * @param options.routingOptions.requireExactMatch - Only use providers with full capability support
   * @param options.routingOptions.allowDegradation - Allow content processing for unsupported types
   * @param options.routingOptions.maxRetries - Maximum number of fallback providers to try
   * @returns Promise resolving to the AI response and routing information
   * @throws AxMediaNotSupportedError when no suitable provider can handle the request
   *
   * @example
   * ```typescript
   * const result = await router.chat(
   *   { chatPrompt: [{ role: 'user', content: [{ type: 'image', image: '...' }] }] },
   *   {
   *     processingOptions: { fallbackBehavior: 'degrade' },
   *     routingOptions: { allowDegradation: true }
   *   }
   * );
   *
   * console.log(`Provider: ${result.routing.provider.getName()}`);
   * console.log(`Processing applied: ${result.routing.processingApplied}`);
   * ```
   */
  async chat(
    request: AxChatRequest,
    options: AxAIServiceOptions & {
      fallbackProviders?: AxAIService[];
      processingOptions?: ProcessingOptions;
      routingOptions?: {
        requireExactMatch?: boolean;
        allowDegradation?: boolean;
        maxRetries?: number;
      };
    } = {}
  ): Promise<{
    response: AxChatResponse | ReadableStream<AxChatResponse>;
    routing: AxRoutingResult;
  }> {
    const routingResult = await this.selectProviderWithDegradation(
      request,
      options.routingOptions || {}
    );

    const processedRequest = await this.preprocessRequest(
      request,
      routingResult.provider,
      options.processingOptions
    );

    try {
      const response = await routingResult.provider.chat(
        processedRequest,
        options
      );

      return {
        response,
        routing: routingResult,
      };
    } catch (error) {
      if (
        error instanceof AxMediaNotSupportedError &&
        options.fallbackProviders?.length
      ) {
        // Try fallback providers
        return await this.tryFallbackProviders(
          request,
          options.fallbackProviders,
          options
        );
      }
      throw error;
    }
  }

  /**
   * Preprocesses request content for the target provider
   */
  private async preprocessRequest(
    request: AxChatRequest,
    provider: AxAIService,
    processingOptions?: ProcessingOptions
  ): Promise<AxChatRequest> {
    const enhancedOptions: ProcessingOptions = {
      ...processingOptions,
      fallbackBehavior: processingOptions?.fallbackBehavior || 'degrade',
      imageToText:
        processingOptions?.imageToText || this.processingServices.imageToText,
      audioToText:
        processingOptions?.audioToText || this.processingServices.audioToText,
      fileToText:
        processingOptions?.fileToText || this.processingServices.fileToText,
      urlToText:
        processingOptions?.urlToText || this.processingServices.urlToText,
    };

    const processedChatPrompt = [];

    for (const message of request.chatPrompt) {
      if (message.role === 'user' && Array.isArray(message.content)) {
        const processedContent = await axProcessContentForProvider(
          message.content,
          provider,
          enhancedOptions
        );

        // Convert processed content back to string format if it's all text
        const allText = processedContent.every((item) => item.type === 'text');
        if (allText && processedContent.length === 1) {
          processedChatPrompt.push({
            ...message,
            content: processedContent[0].text,
          });
        } else {
          // Keep as array format
          processedChatPrompt.push({
            ...message,
            content: processedContent.map((item) => ({
              type: 'text' as const,
              text: item.text,
            })),
          });
        }
      } else {
        processedChatPrompt.push(message);
      }
    }

    return {
      ...request,
      chatPrompt: processedChatPrompt,
    };
  }

  /**
   * Selects provider with graceful degradation
   */
  private async selectProviderWithDegradation(
    request: AxChatRequest,
    options: {
      requireExactMatch?: boolean;
      allowDegradation?: boolean;
      maxRetries?: number;
    }
  ): Promise<AxRoutingResult> {
    const requirements = axAnalyzeRequestRequirements(request);
    const processingApplied: string[] = [];
    const degradations: string[] = [];
    const warnings: string[] = [];

    try {
      const provider = axSelectOptimalProvider(request, this.providers, {
        requireExactMatch:
          options.requireExactMatch ?? this.config.capability.requireExactMatch,
        allowDegradation:
          options.allowDegradation ?? this.config.capability.allowDegradation,
      });

      const features = provider.getFeatures();

      // Check what degradations will be applied
      if (requirements.hasImages && !features.media.images.supported) {
        degradations.push('Images will be converted to text descriptions');
        processingApplied.push('Image-to-text conversion');
      }

      if (requirements.hasAudio && !features.media.audio.supported) {
        degradations.push('Audio will be transcribed to text');
        processingApplied.push('Audio-to-text transcription');
      }

      if (requirements.hasFiles && !features.media.files.supported) {
        degradations.push('File content will be extracted to text');
        processingApplied.push('File-to-text extraction');
      }

      if (requirements.hasUrls && !features.media.urls.supported) {
        degradations.push('URL content will be pre-fetched');
        processingApplied.push('URL content fetching');
      }

      if (requirements.requiresStreaming && !features.streaming) {
        warnings.push('Streaming not supported - will use non-streaming mode');
      }

      if (requirements.requiresCaching && !features.caching.supported) {
        warnings.push('Content caching not supported');
      }

      return {
        provider,
        processingApplied,
        degradations,
        warnings,
      };
    } catch (error) {
      throw new Error(
        `Provider selection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Tries fallback providers when primary provider fails
   */
  private async tryFallbackProviders(
    request: AxChatRequest,
    fallbackProviders: AxAIService[],
    options: AxAIServiceOptions
  ): Promise<{
    response: AxChatResponse | ReadableStream<AxChatResponse>;
    routing: AxRoutingResult;
  }> {
    for (const fallbackProvider of fallbackProviders) {
      try {
        const routingResult: AxRoutingResult = {
          provider: fallbackProvider,
          processingApplied: ['Fallback provider selection'],
          degradations: [
            'Using fallback provider due to primary provider failure',
          ],
          warnings: [],
        };

        const processedRequest = await this.preprocessRequest(
          request,
          fallbackProvider,
          { fallbackBehavior: 'degrade' }
        );

        const response = await fallbackProvider.chat(processedRequest, options);

        return {
          response,
          routing: routingResult,
        };
      } catch (_fallbackError) {}
    }

    throw new Error('All fallback providers failed');
  }

  /**
   * Gets routing recommendation without executing the request.
   *
   * Analyzes the request and returns routing information including which provider
   * would be selected, what processing would be applied, and any degradations or warnings.
   *
   * @param request - The chat request to analyze
   * @returns Promise resolving to routing result with provider selection and processing info
   *
   * @example
   * ```typescript
   * const recommendation = await router.getRoutingRecommendation(request);
   * console.log(`Would use: ${recommendation.provider.getName()}`);
   * console.log(`Degradations: ${recommendation.degradations.join(', ')}`);
   * ```
   */
  async getRoutingRecommendation(
    request: AxChatRequest
  ): Promise<AxRoutingResult> {
    return await this.selectProviderWithDegradation(request, {});
  }

  /**
   * Validates whether the configured providers can handle a specific request.
   *
   * Performs pre-flight validation to check if the request can be successfully
   * processed by available providers, identifies potential issues, and provides
   * recommendations for improving compatibility.
   *
   * @param request - The chat request to validate
   * @returns Promise resolving to validation result with handling capability and recommendations
   *
   * @example
   * ```typescript
   * const validation = await router.validateRequest(request);
   * if (!validation.canHandle) {
   *   console.log('Issues:', validation.issues);
   *   console.log('Recommendations:', validation.recommendations);
   * }
   * ```
   */
  async validateRequest(request: AxChatRequest): Promise<{
    canHandle: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const requirements = axAnalyzeRequestRequirements(request);
    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      const routingResult = await this.selectProviderWithDegradation(
        request,
        {}
      );

      if (routingResult.degradations.length > 0) {
        issues.push(...routingResult.degradations);
        recommendations.push(
          'Consider using a provider that natively supports all media types'
        );
      }

      if (routingResult.warnings.length > 0) {
        issues.push(...routingResult.warnings);
      }

      // Check if we have processing services for required degradations
      if (
        requirements.hasImages &&
        this.processingServices.imageToText === undefined
      ) {
        const hasImageProvider = this.providers.some(
          (p) => p.getFeatures().media.images.supported
        );
        if (!hasImageProvider) {
          issues.push(
            'No image processing service available and no providers support images'
          );
          recommendations.push(
            'Add imageToText processing service or use image-capable provider'
          );
        }
      }

      if (
        requirements.hasAudio &&
        this.processingServices.audioToText === undefined
      ) {
        const hasAudioProvider = this.providers.some(
          (p) => p.getFeatures().media.audio.supported
        );
        if (!hasAudioProvider) {
          issues.push(
            'No audio processing service available and no providers support audio'
          );
          recommendations.push(
            'Add audioToText processing service or use audio-capable provider'
          );
        }
      }

      return {
        canHandle: issues.length === 0 || routingResult.degradations.length > 0,
        issues,
        recommendations,
      };
    } catch (error) {
      return {
        canHandle: false,
        issues: [
          `Cannot route request: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ],
        recommendations: [
          'Add more providers or processing services to handle this request',
        ],
      };
    }
  }

  /**
   * Gets detailed statistics about the router's provider capabilities.
   *
   * Returns information about available providers, their supported capabilities,
   * and routing recommendations for analysis and debugging purposes.
   *
   * @returns Object containing provider statistics and capability matrix
   *
   * @example
   * ```typescript
   * const stats = router.getRoutingStats();
   * console.log(`Total providers: ${stats.totalProviders}`);
   * console.log('Capabilities:');
   * for (const [capability, providers] of Object.entries(stats.capabilityMatrix)) {
   *   console.log(`  ${capability}: ${providers.join(', ')}`);
   * }
   * ```
   */
  getRoutingStats(): {
    totalProviders: number;
    capabilityMatrix: {
      [capability: string]: string[];
    };
    recommendedProvider: string;
  } {
    const capabilityMatrix: { [capability: string]: string[] } = {};

    // Build capability matrix
    for (const provider of this.providers) {
      const features = provider.getFeatures();
      const name = provider.getName();

      if (features.functions) {
        capabilityMatrix.Functions = capabilityMatrix.Functions || [];
        capabilityMatrix.Functions.push(name);
      }

      if (features.streaming) {
        capabilityMatrix.Streaming = capabilityMatrix.Streaming || [];
        capabilityMatrix.Streaming.push(name);
      }

      if (features.media.images.supported) {
        capabilityMatrix.Images = capabilityMatrix.Images || [];
        capabilityMatrix.Images.push(name);
      }

      if (features.media.audio.supported) {
        capabilityMatrix.Audio = capabilityMatrix.Audio || [];
        capabilityMatrix.Audio.push(name);
      }

      if (features.media.files.supported) {
        capabilityMatrix.Files = capabilityMatrix.Files || [];
        capabilityMatrix.Files.push(name);
      }

      if (features.media.urls.supported) {
        capabilityMatrix.URLs = capabilityMatrix.URLs || [];
        capabilityMatrix.URLs.push(name);
      }

      if (features.caching.supported) {
        capabilityMatrix.Caching = capabilityMatrix.Caching || [];
        capabilityMatrix.Caching.push(name);
      }
    }

    return {
      totalProviders: this.providers.length,
      capabilityMatrix,
      recommendedProvider: this.providers[0]?.getName() || 'None',
    };
  }
}
