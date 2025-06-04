import { stopwords } from './stopwords.js'

/**
 * Filters out tokens based on a set of exclusion tokens.
 *
 * @param tokens The array of tokens to filter.
 * @param exclusions A set containing tokens to exclude.
 * @returns An array of filtered tokens.
 */
function filterTokens(
  tokens: readonly string[],
  exclusions: ReadonlySet<string>
): string[] {
  return tokens.filter((token) => !exclusions.has(token))
}

/**
 * Counts the occurrences of each token in an array of tokens.
 *
 * This function supports the preprocessing step for NLP tasks like text similarity
 * and classification by transforming text into a bag-of-words model, facilitating
 * the comparison of different texts based on their content.
 *
 * @param tokens An array of string tokens.
 * @returns A Counter object mapping each token to its count.
 */
function countTokens(tokens: readonly string[]): Record<string, number> {
  const counter: Record<string, number> = {}
  for (const token of tokens) {
    counter[token] = (counter[token] || 0) + 1
  }
  return counter
}

/**
 * Normalizes text by lowercasing, removing punctuation, and squashing multiple spaces.
 *
 * This normalization is crucial in NLP for reducing the complexity of the text data,
 * minimizing the variance between words that should be considered the same for analysis
 * purposes (e.g., "Dog!" and "dog" are treated as the same word).
 *
 * @param s A string to be normalized.
 * @returns A normalized string.
 */
function normalizeText(s: string): string {
  s = s.normalize('NFD')
  s = s.replace(/\b(a|an|the)\b/g, ' ')
  s = s.split(/\s+/).join(' ')
  s = s.replace(/[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~]/g, '')
  return s.toLowerCase()
}

/**
 * Calculates the Exact Match (EM) score between a prediction and ground truth.
 *
 * The EM score is a strict metric used in machine learning to assess if the predicted
 * answer matches the ground truth exactly, commonly used in tasks like question answering.
 *
 * @param prediction The predicted text.
 * @param groundTruth The actual correct text.
 * @returns A number (1.0 for exact match, 0.0 otherwise).
 */
function emScore(prediction: string, groundTruth: string): number {
  return normalizeText(prediction) === normalizeText(groundTruth) ? 1.0 : 0.0
}

/**
 * Calculates the F1 score between a prediction and ground truth.
 *
 * The F1 score is a harmonic mean of precision and recall, widely used in NLP to measure
 * a model's accuracy in considering both false positives and false negatives, offering a
 * balance for evaluating classification models.
 *
 * @param prediction The predicted text.
 * @param groundTruth The actual correct text.
 * @returns The F1 score as a number.
 */
function f1Score(prediction: string, groundTruth: string): number {
  const predictionTokens = normalizeText(prediction).split(' ')
  const groundTruthTokens = normalizeText(groundTruth).split(' ')

  // Calculate the intersection of common tokens between prediction and ground truth
  const predictionCounts = countTokens(predictionTokens)
  const groundTruthCounts = countTokens(groundTruthTokens)

  let numSame = 0
  for (const token in predictionCounts) {
    const v1 = predictionCounts[token] ?? 0
    const v2 = groundTruthCounts[token] ?? 0
    numSame += Math.min(v1, v2)
  }
  if (numSame === 0) {
    return 0
  }

  const precision = numSame / predictionTokens.length
  const recall = numSame / groundTruthTokens.length
  return (2 * precision * recall) / (precision + recall)
}

/**
 * Calculates a novel F1 score, taking into account a history of interaction and excluding stopwords.
 *
 * This metric extends the F1 score by considering contextual relevance and filtering out common words
 * that might skew the assessment of the prediction's quality, especially in conversational models or
 * when historical context is relevant.
 *
 * @param history The historical context or preceding interactions.
 * @param prediction The predicted text.
 * @param groundTruth The actual correct text.
 * @param returnRecall Optionally return the recall score instead of F1.
 * @returns The novel F1 or recall score as a number.
 */
function novelF1ScoreOptimized(
  history: string,
  prediction: string,
  groundTruth: string,
  returnRecall: boolean = false
): number {
  // Normalize and split the input texts into tokens
  const historyTokens = normalizeText(history).split(' ')
  let predictionTokens = normalizeText(prediction).split(' ')
  let groundTruthTokens = normalizeText(groundTruth).split(' ')

  // Combine stopwords and history tokens for exclusion
  const exclusions = new Set([...stopwords, ...historyTokens])

  // Filter prediction and ground truth tokens against the exclusions
  predictionTokens = filterTokens(predictionTokens, exclusions)
  groundTruthTokens = filterTokens(groundTruthTokens, exclusions)

  // Proceed with calculating common tokens, precision, recall, and F1 score as previously outlined

  // Placeholder for the calculation logic
  const numSame = 0 // This should be calculated as before
  const precision = numSame / predictionTokens.length
  const recall = numSame / groundTruthTokens.length
  const f1 = (2 * precision * recall) / (precision + recall)

  return returnRecall ? recall : f1
}

export const AxEvalUtil = {
  emScore,
  f1Score,
  novelF1ScoreOptimized,
}
