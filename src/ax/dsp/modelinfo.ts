import type { AxAIInputModelList, AxModelInfo } from '../ai/types.js'

interface GetModelInfoParams<TModel = string, TEmbedModel = undefined> {
  model: TModel
  modelInfo: readonly AxModelInfo[]
  models?: AxAIInputModelList<TModel, TEmbedModel>
}

export function getModelInfo<TModel = string, TEmbedModel = undefined>({
  model,
  modelInfo,
  models,
}: Readonly<
  GetModelInfoParams<TModel, TEmbedModel>
>): Readonly<AxModelInfo> | null {
  // First check if there's a mapping for this model
  const modelEntry = models?.find((v) => v.key === model)
  const mappedModel =
    modelEntry && 'model' in modelEntry
      ? (modelEntry.model as string)
      : (model as string)

  // Try exact match first
  const exactMatch = modelInfo.find((v) => v.name === model)
  if (exactMatch) return exactMatch

  // Handle normalization if no exact match
  const normalizedName = mappedModel
    // Remove vendor prefixes
    .replace(/^(anthropic\.|openai\.)/, '')
    // Remove various postfixes one by one, stopping after first match
    .replace(/-latest$/, '')
    .replace(/-\d{8}$/, '') // YYYYMMDD
    .replace(/-v\d+:\d+$/, '') // v2:0
    .replace(/@\d{8}$/, '') // @YYYYMMDD
    .replace(/-\d{2,}(-[a-zA-Z0-9-]+)?$/, '') // XX or XXXXX-something
    .replace(/-v\d+@\d{8}$/, '') // vX@YYYYMMDD
    .replace(/-v\d+$/, '') // Remove standalone version number

  // Try to find a match with the normalized name
  const normalizedMatch = modelInfo.find((v) => v.name === normalizedName)
  if (normalizedMatch) return normalizedMatch

  // Return default if no match found
  return null
}
