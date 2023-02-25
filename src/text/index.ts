export * from './memory';
export * from './generate';

export type GenerateResponse = {
  id: string;
  sessionID?: string;
  query: string;
  values: { id: string; text: string }[];
};

export type EmbedResponse = {
  id: string;
  sessionID?: string;
  texts: string[];
  model: string;
  embeddings: number[];
};

export interface AIMemory {
  add(text: string, sessionID?: string): void;
  history(sessionID?: string): string;
  peek(sessionID?: string): Readonly<string[]>;
}

export type Embeddings = {
  model: string;
  embeddings: number[];
};

export type PromptAction = {
  readonly name: string;
  readonly description: string;
  action(text: string, embeds?: Embeddings): string;
};

export type PromptMetadata = {
  readonly stopSequences: string[];
  readonly queryPrefix?: string;
  readonly responsePrefix?: string;
  readonly actionName?: RegExp;
  readonly actionValue?: RegExp;
  readonly finalValue?: RegExp;
};

export interface AIPrompt {
  metadata(): Readonly<PromptMetadata>;
  actions?(): ReadonlyArray<PromptAction>;
  create(query: string, history: () => string, ai: AIService): string;
}

export interface AIService {
  name(): string;
  generate(
    prompt: string,
    md?: PromptMetadata,
    sessionID?: string
  ): Promise<GenerateResponse>;
  embed(texts: string[], sessionID?: string): Promise<EmbedResponse>;
}

/*
Magic isn't always unicorns and fairy dust␊
Sometimes it's computer code and technology that's quite a bit of work␊
But if you learn the tricks and the trades␊
You'll find there's a wonder that awaits␊

With a computer and some basic coding␊
You can make anything your heart desires␊
From games that you'll play for hours on end␊
To apps that will make life much more fun␊

So don't be afraid of the unknown␊
Embrace the magic of computer code␊
And you'll find that your dreams can come true␊
With just a little bit of coding, you can do anything too!
*/
