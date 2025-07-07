import type {
  AxAIService,
  AxAIServiceActionOptions,
  AxFunction,
} from '../ai/types.js'

export class AxEmbeddingAdapter {
  private aiService: AxAIService
  private info: {
    name: string
    description: string
    argumentDescription: string
  }
  private func: (
    args: readonly number[],
    extra?: Readonly<AxAIServiceActionOptions>
  ) => Promise<unknown>

  constructor({
    ai,
    info,
    func,
  }: Readonly<{
    ai: AxAIService
    info: Readonly<{
      name: string
      description: string
      argumentDescription: string
    }>
    func: (
      args: readonly number[],
      extra?: Readonly<AxAIServiceActionOptions>
    ) => Promise<unknown>
  }>) {
    this.aiService = ai
    this.info = info
    this.func = func
  }

  private async embedAdapter(
    text: string,
    extra?: Readonly<AxAIServiceActionOptions>
  ): Promise<unknown> {
    const embedRes = await this.aiService.embed(
      { texts: [text] },
      {
        sessionId: extra?.sessionId,
        abortSignal: extra?.abortSignal,
      }
    )
    const embeds = embedRes.embeddings.at(0)

    if (!embeds) {
      throw new Error('Failed to embed text')
    }

    return this.func.length === 2 ? this.func(embeds, extra) : this.func(embeds)
  }

  public toFunction(): AxFunction {
    return {
      name: this.info.name,
      description: this.info.description,
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: this.info.argumentDescription,
          },
        },
        required: ['text'],
      },
      func: ({ text }: Readonly<{ text: string }>, options) =>
        this.embedAdapter(text, options),
    }
  }
}
