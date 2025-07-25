import {
  AxContentProcessingError,
  AxMediaNotSupportedError,
} from '../util/apicall.js';
import type { AxAIService } from './types.js';

/**
 * Configuration options for content processing and fallback behavior
 */
export interface ProcessingOptions {
  /** How to handle unsupported content types: 'error' throws, 'degrade' converts to text, 'skip' omits */
  fallbackBehavior?: 'error' | 'degrade' | 'skip';
  /** Service to convert images to text descriptions */
  imageToText?: (imageData: string) => Promise<string>;
  /** Service to convert audio to text transcriptions */
  audioToText?: (audioData: string, format?: string) => Promise<string>;
  /** Service to extract text from files */
  fileToText?: (fileData: string, mimeType: string) => Promise<string>;
  /** Service to fetch and extract text from URLs */
  urlToText?: (url: string) => Promise<string>;
}

/**
 * Represents processed content that has been converted to text format
 */
export interface ProcessedContent {
  /** Content type after processing (always 'text') */
  type: 'text';
  /** The processed text content */
  text: string;
}

/**
 * Indicates what types of media content are present in a request
 */
export interface MediaRequirements {
  /** Whether the content includes images */
  hasImages: boolean;
  /** Whether the content includes audio */
  hasAudio: boolean;
  /** Whether the content includes files */
  hasFiles: boolean;
  /** Whether the content includes URLs */
  hasUrls: boolean;
}

/**
 * Processes content for a specific AI provider, handling unsupported media types.
 *
 * This function takes mixed content (text, images, audio, files, URLs) and transforms
 * it to formats supported by the target provider. Unsupported content types are
 * handled according to the fallback behavior:
 * - 'error': Throws AxMediaNotSupportedError
 * - 'degrade': Converts to text using fallback services or alt text
 * - 'skip': Omits the unsupported content
 *
 * @param content - The content to process (string, object, or array of content items)
 * @param provider - The target AI service provider
 * @param options - Processing options including fallback behavior and conversion services
 * @returns Promise resolving to array of processed content items (all converted to text)
 * @throws AxMediaNotSupportedError when fallbackBehavior is 'error' and content is unsupported
 * @throws AxContentProcessingError when a conversion service fails
 *
 * @example
 * ```typescript
 * const processed = await axProcessContentForProvider(
 *   [
 *     { type: 'text', text: 'Analyze this:' },
 *     { type: 'image', image: 'base64...', altText: 'Chart showing sales data' }
 *   ],
 *   textOnlyProvider,
 *   {
 *     fallbackBehavior: 'degrade',
 *     imageToText: async (data) => await visionService.describe(data)
 *   }
 * );
 * // Result: [{ type: 'text', text: 'Analyze this:' }, { type: 'text', text: 'Chart showing sales data' }]
 * ```
 */
export async function axProcessContentForProvider(
  content: any,
  provider: AxAIService,
  options: ProcessingOptions = {}
): Promise<ProcessedContent[]> {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }

  if (!Array.isArray(content)) {
    return [{ type: 'text', text: String(content) }];
  }

  const features = provider.getFeatures();
  const processedContent: ProcessedContent[] = [];

  for (const item of content) {
    try {
      switch (item.type) {
        case 'text':
          processedContent.push({ type: 'text', text: item.text });
          break;

        case 'image':
          if (features.media.images.supported) {
            // Provider supports images - validate and pass through as text description
            if (item.altText) {
              processedContent.push({
                type: 'text',
                text: `[Image: ${item.altText}]`,
              });
            } else {
              processedContent.push({
                type: 'text',
                text: '[Image content]',
              });
            }
          } else if (item.altText) {
            // Fallback to alt text
            processedContent.push({ type: 'text', text: item.altText });
          } else if (options.imageToText) {
            // Use AI vision service to describe image
            try {
              const description = await options.imageToText(item.image);
              processedContent.push({ type: 'text', text: description });
            } catch (error) {
              throw new AxContentProcessingError(
                error as Error,
                'image',
                'vision analysis'
              );
            }
          } else {
            // Handle based on fallback behavior
            switch (options.fallbackBehavior) {
              case 'error':
                throw new AxMediaNotSupportedError(
                  'Images',
                  provider.getName(),
                  false
                );
              case 'skip':
                continue; // Skip this content item
              default:
                processedContent.push({
                  type: 'text',
                  text: '[Image content not supported by this provider]',
                });
            }
          }
          break;

        case 'audio':
          if (features.media.audio.supported) {
            // Provider supports audio - use transcription if available
            if (item.transcription) {
              processedContent.push({
                type: 'text',
                text: item.transcription,
              });
            } else {
              processedContent.push({
                type: 'text',
                text: '[Audio content]',
              });
            }
          } else if (item.transcription) {
            // Use provided transcription
            processedContent.push({ type: 'text', text: item.transcription });
          } else if (options.audioToText) {
            // Use speech-to-text service
            try {
              const transcription = await options.audioToText(
                item.data,
                item.format
              );
              processedContent.push({ type: 'text', text: transcription });
            } catch (error) {
              throw new AxContentProcessingError(
                error as Error,
                'audio',
                'transcription'
              );
            }
          } else {
            // Fallback behavior
            switch (options.fallbackBehavior) {
              case 'error':
                throw new AxMediaNotSupportedError(
                  'Audio',
                  provider.getName(),
                  false
                );
              case 'skip':
                continue;
              case 'degrade':
                processedContent.push({
                  type: 'text',
                  text: '[Audio content not supported by this provider]',
                });
            }
          }
          break;

        case 'file':
          if (features.media.files.supported) {
            // Provider supports files - use extracted text if available
            if (item.extractedText) {
              processedContent.push({
                type: 'text',
                text: item.extractedText,
              });
            } else {
              processedContent.push({
                type: 'text',
                text: `[File: ${item.filename}]`,
              });
            }
          } else if (item.extractedText) {
            processedContent.push({ type: 'text', text: item.extractedText });
          } else if (options.fileToText) {
            try {
              const extractedText = await options.fileToText(
                item.data,
                item.mimeType
              );
              processedContent.push({ type: 'text', text: extractedText });
            } catch (error) {
              throw new AxContentProcessingError(
                error as Error,
                'file',
                'text extraction'
              );
            }
          } else {
            // Fallback behavior
            switch (options.fallbackBehavior) {
              case 'error':
                throw new AxMediaNotSupportedError(
                  'Files',
                  provider.getName(),
                  false
                );
              case 'skip':
                continue;
              default:
                processedContent.push({
                  type: 'text',
                  text: `[File: ${item.filename} - content not accessible by this provider]`,
                });
            }
          }
          break;

        case 'url':
          if (features.media.urls.supported) {
            // Provider supports URLs - use cached content if available
            if (item.cachedContent) {
              processedContent.push({
                type: 'text',
                text: item.cachedContent,
              });
            } else {
              processedContent.push({
                type: 'text',
                text: `[Link: ${item.url}${item.title ? ` - ${item.title}` : ''}]`,
              });
            }
          } else if (item.cachedContent) {
            processedContent.push({ type: 'text', text: item.cachedContent });
          } else if (options.urlToText) {
            try {
              const fetchedContent = await options.urlToText(item.url);
              processedContent.push({ type: 'text', text: fetchedContent });
            } catch (error) {
              throw new AxContentProcessingError(
                error as Error,
                'url',
                'content fetching'
              );
            }
          } else {
            // Fallback behavior
            switch (options.fallbackBehavior) {
              case 'error':
                throw new AxMediaNotSupportedError(
                  'URLs',
                  provider.getName(),
                  false
                );
              case 'skip':
                continue;
              case 'degrade':
                processedContent.push({
                  type: 'text',
                  text: `[Link: ${item.url}${item.title ? ` - ${item.title}` : ''}]`,
                });
            }
          }
          break;

        default:
          // Pass through any unrecognized content types as text
          if (typeof item === 'object' && item.text) {
            processedContent.push({ type: 'text', text: item.text });
          } else {
            processedContent.push({ type: 'text', text: String(item) });
          }
      }
    } catch (error) {
      if (
        error instanceof AxMediaNotSupportedError ||
        error instanceof AxContentProcessingError
      ) {
        throw error;
      }
      throw new AxContentProcessingError(
        error as Error,
        item.type || 'unknown',
        'content processing'
      );
    }
  }

  return processedContent;
}

/**
 * Analyzes a chat prompt to determine what media types it contains.
 *
 * Scans through chat messages to identify the types of media content present,
 * which can be used for provider capability matching and routing decisions.
 *
 * @param chatPrompt - Array of chat messages to analyze
 * @returns Object indicating which media types are present in the chat prompt
 *
 * @example
 * ```typescript
 * const requirements = axAnalyzeChatPromptRequirements([
 *   {
 *     role: 'user',
 *     content: [
 *       { type: 'text', text: 'Analyze this:' },
 *       { type: 'image', image: 'base64...' },
 *       { type: 'file', filename: 'report.pdf' }
 *     ]
 *   }
 * ]);
 * // Result: { hasImages: true, hasAudio: false, hasFiles: true, hasUrls: false }
 * ```
 */
export function axAnalyzeChatPromptRequirements(
  chatPrompt: any[]
): MediaRequirements {
  let hasImages = false;
  let hasAudio = false;
  let hasFiles = false;
  let hasUrls = false;

  for (const message of chatPrompt) {
    if (message.role === 'user' && Array.isArray(message.content)) {
      for (const part of message.content) {
        switch (part.type) {
          case 'image':
            hasImages = true;
            break;
          case 'audio':
            hasAudio = true;
            break;
          case 'file':
            hasFiles = true;
            break;
          case 'url':
            hasUrls = true;
            break;
        }
      }
    }
  }

  return { hasImages, hasAudio, hasFiles, hasUrls };
}

// Note: axSelectOptimalProvider is now available in capabilities.ts for more advanced provider selection
