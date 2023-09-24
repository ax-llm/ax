import {
  AnthropicApi,
  AnthropicCompletionMiddleware,
  CohereApi,
  CohereCompletionMiddleware,
  GoogleMiddleware,
  HuggingFaceApi,
  HuggingFaceCompletionMiddleware,
  OpenAIApi,
  OpenAIChatMiddleware,
  OpenAICompletionMiddleware,
  TogetherCompletionMiddleware,
} from '../ai/index.js';
import { TogetherApi } from '../ai/together/types.js';
import { AIMiddleware } from '../ai/types.js';

import { ExtendedIncomingMessage } from './types.js';

type Routes = {
  name: string;
  target: string | ((host?: string) => string);
  hostRequired?: boolean;
  routes: {
    path: string;
    middleware: (req: Readonly<ExtendedIncomingMessage>) => AIMiddleware;
  }[];
};

export const routes: Routes[] = [
  {
    name: 'openai',
    target: 'https://api.openai.com',
    routes: [
      {
        path: OpenAIApi.Completion,
        middleware: (req) => new OpenAICompletionMiddleware(req),
      },
      {
        path: OpenAIApi.Chat,
        middleware: (req) => new OpenAIChatMiddleware(req),
      },
    ],
  },
  {
    name: 'azure-openai',
    target: (host?: string) => `https://${host}.openai.azure.com/`,
    hostRequired: true,
    routes: [
      {
        path: OpenAIApi.Completion,
        middleware: (req) => new OpenAICompletionMiddleware(req),
      },
      {
        path: OpenAIApi.Chat,
        middleware: (req) => new OpenAIChatMiddleware(req),
      },
    ],
  },
  {
    name: 'huggingface',
    target: 'https://api-inference.huggingface.co/',
    routes: [
      {
        path: HuggingFaceApi.Completion,
        middleware: (req) => new HuggingFaceCompletionMiddleware(req),
      },
    ],
  },
  {
    name: 'together',
    target: 'https://api.together.xyz/',
    routes: [
      {
        path: TogetherApi.Completion,
        middleware: (req) => new TogetherCompletionMiddleware(req),
      },
    ],
  },
  {
    name: 'google',
    target: (host?: string) =>
      `https://${host ?? 'us-central1'}-aiplatform.googleapis.com`,
    routes: [
      {
        path: `/v1/projects`,
        middleware: (req) => new GoogleMiddleware(req),
      },
    ],
  },
  {
    name: 'anthropic',
    target: 'https://api.anthropic.com',
    routes: [
      {
        path: AnthropicApi.Completion,
        middleware: (req) => new AnthropicCompletionMiddleware(req),
      },
    ],
  },
  {
    name: 'cohere',
    target: 'https://api.cohere.ai/',
    routes: [
      {
        path: CohereApi.Completion,
        middleware: (req) => new CohereCompletionMiddleware(req),
      },
    ],
  },
];

export const parserMap = new Map<string, Routes>(
  routes.map((pm) => [pm.name, pm])
);
