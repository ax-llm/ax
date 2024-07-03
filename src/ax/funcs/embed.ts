import type {
  AxAIService,
  AxAIServiceActionOptions,
  AxFunction,
  AxFunctionHandler
} from '../ai/index.js';

export const axEmbedAdapter = (
  ai: AxAIService,
  info: Readonly<{
    name: string;
    description: string;
    argumentDescription: string;
  }>,
  func: (
    args: readonly number[],
    extra?: Readonly<AxAIServiceActionOptions>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>
): AxFunction => ({
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
    extra?: Readonly<AxAIServiceActionOptions>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> => {
    return new Promise((resolve) => {
      resolve(embedAdapter(ai, text, func, extra));
    });
  }
});

const embedAdapter = async (
  ai: AxAIService,
  text: string,
  func: AxFunctionHandler,
  extra?: Readonly<AxAIServiceActionOptions>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> => {
  const embedRes = await ai.embed(
    { texts: [text] },
    { sessionId: extra?.sessionId }
  );
  const embeds = embedRes.embeddings.at(0);

  return func.length === 2 ? func(embeds, extra) : func(embeds);
};
