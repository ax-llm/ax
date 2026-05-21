import type { AxPromptMetrics } from '../../ai/promptMetrics.js';
import type {
  AxAIService,
  AxChatResponse,
  AxDebugChatResponseUsage,
  AxLoggerFunction,
  AxModelUsage,
} from '../../ai/types.js';

type UsageLogArgs = Readonly<{
  ai: Readonly<AxAIService>;
  usage: AxModelUsage[];
  modelUsage?: AxModelUsage;
  citations?: NonNullable<AxModelUsage['citations']>;
  debug: boolean;
  logger?: AxLoggerFunction;
  debugPromptMetrics?: Readonly<AxPromptMetrics>;
}>;

export function collectResultCitations(
  results: Readonly<AxChatResponse['results']>
): NonNullable<AxModelUsage['citations']> {
  const citations: NonNullable<AxModelUsage['citations']> = [];
  for (const result of results) {
    if (!Array.isArray(result?.citations)) continue;
    for (const c of result.citations) {
      if (c?.url) {
        citations.push({
          url: c.url,
          title: c.title,
          description: c.description,
          license: c.license,
          publicationDate: c.publicationDate,
          snippet: c.snippet,
        });
      }
    }
  }
  return citations;
}

export function mergeUsageCitations(
  modelUsage: AxModelUsage,
  citations: NonNullable<AxModelUsage['citations']>
): AxModelUsage {
  const dedup = Array.from(
    new Map(
      citations.filter((c) => c.url).map((c) => [c.url as string, c])
    ).values()
  );

  return {
    ...modelUsage,
    ...(dedup.length ? { citations: dedup } : {}),
  };
}

export function pushAndLogUsage({
  ai,
  usage,
  modelUsage,
  citations = [],
  debug,
  logger,
  debugPromptMetrics,
}: UsageLogArgs): void {
  if (!modelUsage) return;

  const usageWithCitations = mergeUsageCitations(modelUsage, citations);
  usage.push(usageWithCitations);

  if (!debug || !logger) return;

  const usageWithoutCitations: AxDebugChatResponseUsage = {
    ...usageWithCitations,
  };
  delete usageWithoutCitations.citations;

  if (debugPromptMetrics) {
    usageWithoutCitations.systemPromptCharacters =
      debugPromptMetrics.systemPromptCharacters;
    usageWithoutCitations.exampleChatContextCharacters =
      debugPromptMetrics.exampleChatContextCharacters;
    usageWithoutCitations.mutableChatContextCharacters =
      debugPromptMetrics.mutableChatContextCharacters;
    usageWithoutCitations.chatContextCharacters =
      debugPromptMetrics.chatContextCharacters;
    usageWithoutCitations.totalPromptCharacters =
      debugPromptMetrics.totalPromptCharacters;
  }

  const estimatedCost = ai.getEstimatedCost(modelUsage);
  if (estimatedCost > 0) {
    usageWithoutCitations.estimatedCost = estimatedCost;
  }

  logger({
    name: 'ChatResponseUsage',
    value: usageWithoutCitations,
  });

  if (usageWithCitations.citations && usageWithCitations.citations.length > 0) {
    logger({
      name: 'ChatResponseCitations',
      value: usageWithCitations.citations,
    });
  }
}
