import {
  generateChatTraceOpenAI,
  generateCompletionTraceOpenAI,
  generateTraceCompletionHuggingFace,
  HuggingFaceApi,
  OpenAIApi,
} from '../ai';
import { generateCompletionTraceCohere } from '../ai/cohere/trace';
import { generateTraceGoogle } from '../ai/google/trace';
import { generateTraceCompletionTogether } from '../ai/together/trace';
import { TogetherApi } from '../ai/together/types';

import { ParserFunction } from './types';

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
