// cspell:ignore mistral, mixtral, codestral, nemo

/**
 * Defines the available Mistral models.
 */
export enum AxAIMistralModel {
  Mistral7B = 'open-mistral-7b',
  Mistral8x7B = 'open-mixtral-8x7b',
  MistralSmall = 'mistral-small-latest',
  MistralNemo = 'mistral-nemo-latest',
  MistralLarge = 'mistral-large-latest',
  Codestral = 'codestral-latest',
  OpenCodestralMamba = 'open-codestral-mamba',
  OpenMistralNemo = 'open-mistral-nemo-latest',
}

/**
 * Defines the available Mistral embedding models.
 */
export enum AxAIMistralEmbedModels {
  MistralEmbed = 'mistral-embed',
}
