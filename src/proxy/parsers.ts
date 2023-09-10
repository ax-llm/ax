import { generateCompletionTraceCohere } from '../ai/cohere/trace.js';
import { generateTraceGoogle } from '../ai/google/trace.js';
import {
  generateChatTraceOpenAI,
  generateCompletionTraceOpenAI,
  generateTraceCompletionHuggingFace,
  HuggingFaceApi,
  OpenAIApi,
} from '../ai/index.js';
import { generateTraceCompletionTogether } from '../ai/together/trace.js';
import { TogetherApi } from '../ai/together/types.js';

import { ParserFunction } from './types.js';

type Parser = {
  name: string;
  target: string | ((host?: string) => string);
  hostRequired?: boolean;
  parsers: {
    path: string;
    fn: ParserFunction;
  }[];
};

export const parserMappings: Parser[] = [
  {
    name: 'openai',
    target: 'https://api.openai.com',
    parsers: [
      {
        path: OpenAIApi.Completion,
        fn: generateCompletionTraceOpenAI,
      },
      { path: OpenAIApi.Chat, fn: generateChatTraceOpenAI },
    ],
  },
  {
    name: 'azure-openai',
    target: (host?: string) => `https://${host}.openai.azure.com/`,
    hostRequired: true,
    parsers: [
      { path: OpenAIApi.Completion, fn: generateCompletionTraceOpenAI },
      { path: OpenAIApi.Chat, fn: generateChatTraceOpenAI },
    ],
  },
  {
    name: 'huggingface',
    target: 'https://api-inference.huggingface.co/',
    parsers: [
      {
        path: HuggingFaceApi.Completion,
        fn: generateTraceCompletionHuggingFace,
      },
    ],
  },
  {
    name: 'together',
    target: 'https://api.together.xyz/',
    parsers: [
      {
        path: TogetherApi.Completion,
        fn: generateTraceCompletionTogether,
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
        fn: generateTraceGoogle,
      },
    ],
  },
  {
    name: 'anthropic',
    target: 'https://api.anthropic.com/',
    parsers: [
      {
        path: '/v1/completions',
        fn: generateTraceCompletionTogether,
      },
    ],
  },
  {
    name: 'cohere',
    target: 'https://api.cohere.ai/',
    parsers: [
      {
        path: '/v1/generate',
        fn: generateCompletionTraceCohere,
      },
    ],
  },
];

export const parserMap = new Map<string, Parser>(
  parserMappings.map((pm) => [pm.name, pm])
);
