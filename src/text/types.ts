import { JSONSchemaType } from 'ajv';

export type AIGenerateTextExtraOptions = {
  sessionID?: string;
  debug: boolean;
};

export type TextModelInfo = {
  id: string;
  currency: string;
  characterIsToken?: boolean;
  promptTokenCostPer1K: number;
  completionTokenCostPer1K: number;
  maxTokens: number;
  oneTPM: number;
};

export type AITokenUsage = {
  model: TextModelInfo;
  stats?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

// eslint-disable-next-line functional/no-mixed-types
export type AIGenerateTextResponse<T> = {
  id: string;
  sessionID?: string;
  query: string;
  values: { id: string; text: string }[];
  usage: AITokenUsage[];
  value(): T;
};

export type EmbedResponse = {
  id: string;
  sessionID?: string;
  texts: readonly string[];
  usage: AITokenUsage;
  embeddings: readonly number[];
};

export type AudioResponse = {
  duration: number;
  segments: {
    id: number;
    start: number;
    end: number;
    text: string;
  }[];
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

// eslint-disable-next-line functional/no-mixed-types
export type PromptFunction = {
  readonly name: string;
  readonly description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly inputSchema: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  func: (args: any) => Promise<any>;
};

export type PromptResponseConfig<T> = {
  keyValue?: boolean;
  schema?: JSONSchemaType<T>;
};

export type PromptConfig<T> = AIPromptConfig & {
  queryPrefix?: string;
  responsePrefix?: string;
  functions?: PromptFunction[];
  responseConfig?: PromptResponseConfig<T>;
};

export type AIPromptConfig = {
  stopSequences: string[];
};

export interface AIService {
  name(): string;
  generate(
    prompt: string,
    md?: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<AIGenerateTextResponse<string>>;
  embed(texts: readonly string[], sessionID?: string): Promise<EmbedResponse>;
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
