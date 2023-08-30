import { PromptFunction } from '../prompts';
import {
  AIService,
  PromptFunctionExtraOptions,
  PromptFunctionFunc,
} from '../text/types';

export const EmbedAdapter = (
  ai: AIService,
  info: Readonly<{
    name: string;
    description: string;
    argumentDescription: string;
  }>,
  func: (
    args: readonly number[],
    extra?: Readonly<PromptFunctionExtraOptions>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>
): PromptFunction => ({
  name: info.name,
  description: info.description,
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: info.argumentDescription,
      },
    },
    required: ['text'],
  },

  func: (
    { text }: Readonly<{ text: string }>,
    extra?: Readonly<PromptFunctionExtraOptions>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> => {
    return new Promise((resolve) => {
      resolve(embedAdapter(ai, text, func, extra));
    });
  },
});

export const embedAdapter = async (
  ai: AIService,
  text: string,
  func: PromptFunctionFunc,
  extra?: Readonly<PromptFunctionExtraOptions>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> => {
  const embedRes = await ai.embed(text, { sessionId: extra?.sessionId });
  const embeds = embedRes.embedding;

  return func.length === 2 ? func(embeds, extra) : func(embeds);
};
