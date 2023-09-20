import {
  AnthropicApi,
  AnthropicCompletionParser,
  CohereApi,
  CohereCompletionParser,
  GoogleParser,
  HuggingFaceApi,
  HuggingFaceCompletionParser,
  OpenAIApi,
  OpenAIChatParser,
  OpenAICompletionParser,
  TogetherCompletionParser,
} from '../ai/index.js';
import { TogetherApi } from '../ai/together/types.js';
import { Parser } from '../ai/types.js';

type Routes = {
  name: string;
  target: string | ((host?: string) => string);
  hostRequired?: boolean;
  parsers: {
    path: string;
    parser: Parser;
  }[];
};

export const routes: Routes[] = [
  {
    name: 'openai',
    target: 'https://api.openai.com',
    parsers: [
      {
        path: OpenAIApi.Completion,
        parser: new OpenAICompletionParser(),
      },
      { path: OpenAIApi.Chat, parser: new OpenAIChatParser() },
    ],
  },
  {
    name: 'azure-openai',
    target: (host?: string) => `https://${host}.openai.azure.com/`,
    hostRequired: true,
    parsers: [
      { path: OpenAIApi.Completion, parser: new OpenAICompletionParser() },
      { path: OpenAIApi.Chat, parser: new OpenAIChatParser() },
    ],
  },
  {
    name: 'huggingface',
    target: 'https://api-inference.huggingface.co/',
    parsers: [
      {
        path: HuggingFaceApi.Completion,
        parser: new HuggingFaceCompletionParser(),
      },
    ],
  },
  {
    name: 'together',
    target: 'https://api.together.xyz/',
    parsers: [
      {
        path: TogetherApi.Completion,
        parser: new TogetherCompletionParser(),
      },
    ],
  },
  {
    name: 'google',
    target: (host?: string) =>
      `https://${host ?? 'us-central1'}-aiplatform.googleapis.com`,
    parsers: [
      {
        path: `/v1/projects`,
        parser: new GoogleParser(),
      },
    ],
  },
  {
    name: 'anthropic',
    target: 'https://api.anthropic.com',
    parsers: [
      {
        path: AnthropicApi.Completion,
        parser: new AnthropicCompletionParser(),
      },
    ],
  },
  {
    name: 'cohere',
    target: 'https://api.cohere.ai/',
    parsers: [
      {
        path: CohereApi.Completion,
        parser: new CohereCompletionParser(),
      },
    ],
  },
];

export const parserMap = new Map<string, Routes>(
  routes.map((pm) => [pm.name, pm])
);
