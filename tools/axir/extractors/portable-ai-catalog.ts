import {
  type AxAIModelCatalogOptions,
  axGetSupportedAIModels,
} from '../../../src/ax/ai/catalog.js';

/** Chrome's LanguageModel host API is TypeScript/JavaScript only. */
export const getPortableAIModels = (options?: AxAIModelCatalogOptions) =>
  axGetSupportedAIModels(options).filter(
    (provider) => provider.name !== 'chrome-ai'
  );
