import type { AxModelInfo } from '../types.js';

import { AxAIMetaModel } from './types.js';

const sparkSupport = {
  thinkingBudget: true,
  showThoughts: true,
  structuredOutputs: true,
  structuredOutputModes: ['native', 'function', 'json_object'] as const,
  operations: ['chat'] as const,
};

const standardDataUse = { providerTraining: 'not-used' as const };
const contributorDataUse = {
  providerTraining: 'allowed' as const,
  appliesTo: ['prompt', 'completion'] as const,
};
const sparkModalities = {
  input: ['text', 'image', 'audio', 'video', 'pdf'] as const,
  output: ['text'] as const,
};

export const axModelInfoMetaSpark: AxModelInfo[] = [
  {
    name: AxAIMetaModel.MuseSpark13,
    contextWindow: 1_048_576,
    supported: sparkSupport,
    audio: { input: true, output: false },
    modalities: sparkModalities,
    dataUse: standardDataUse,
  },
  {
    name: AxAIMetaModel.MuseSpark13Contributor,
    contextWindow: 1_048_576,
    supported: sparkSupport,
    audio: { input: true, output: false },
    modalities: sparkModalities,
    dataUse: contributorDataUse,
  },
  {
    name: AxAIMetaModel.MuseSpark12,
    contextWindow: 1_048_576,
    supported: sparkSupport,
    audio: { input: true, output: false },
    modalities: sparkModalities,
    dataUse: standardDataUse,
  },
  {
    name: AxAIMetaModel.MuseSpark12Contributor,
    contextWindow: 1_048_576,
    supported: sparkSupport,
    audio: { input: true, output: false },
    modalities: sparkModalities,
    dataUse: contributorDataUse,
  },
  {
    name: AxAIMetaModel.MuseSpark11,
    contextWindow: 1_048_576,
    supported: sparkSupport,
    audio: { input: true, output: false },
    modalities: sparkModalities,
    dataUse: standardDataUse,
  },
];

export const axModelInfoMetaMessages: AxModelInfo[] = axModelInfoMetaSpark.map(
  (model) => ({
    ...model,
    supported: {
      ...model.supported,
      structuredOutputs: true,
      structuredOutputModes: ['native', 'function'],
    },
  })
);

export const axModelInfoMeta: AxModelInfo[] = [
  ...axModelInfoMetaSpark,
  {
    name: AxAIMetaModel.MuseImage10,
    supported: {
      imageOutput: true,
      operations: ['chat'],
    },
    notSupported: { temperature: true, topP: true },
    modalities: {
      input: ['text', 'image'],
      output: ['image'],
    },
    dataUse: standardDataUse,
  },
  {
    name: AxAIMetaModel.MuseVoiceTranscribe10,
    supported: { operations: ['chat', 'transcribe'] },
    notSupported: { temperature: true, topP: true },
    audio: { input: true, output: false },
    modalities: { input: ['audio'], output: ['text'] },
    dataUse: standardDataUse,
  },
];
