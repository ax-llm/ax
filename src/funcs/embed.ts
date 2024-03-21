import type {
  AITextFunction,
  AITextFunctionHandler
} from '../text/functions.js';
import type { AIService, AIServiceActionOptions } from '../text/types.js';

export const EmbedAdapter = (
  ai: AIService,
  info: Readonly<{
    name: string;
    description: string;
    argumentDescription: string;
  }>,
  func: (
    args: readonly number[],
    extra?: Readonly<AIServiceActionOptions>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>
): AITextFunction => ({
  name: info.name,
  description: info.description,
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: info.argumentDescription
      }
    },
    required: ['text']
  },

  func: (
    { text }: Readonly<{ text: string }>,
    extra?: Readonly<AIServiceActionOptions>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> => {
    return new Promise((resolve) => {
      resolve(embedAdapter(ai, text, func, extra));
    });
  }
});

export const embedAdapter = async (
  ai: AIService,
  text: string,
  func: AITextFunctionHandler,
  extra?: Readonly<AIServiceActionOptions>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> => {
  const embedRes = await ai.embed(
    { texts: [text] },
    { sessionId: extra?.sessionId }
  );
  const embeds = embedRes.embeddings.at(0);

  return func.length === 2 ? func(embeds, extra) : func(embeds);
};
