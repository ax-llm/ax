/**
 * Utility functions for batch processing in parallel operations
 */

/**
 * Processes an array of promises in batches with concurrency control
 *
 * @param items - Array of items to process
 * @param processor - Function that converts item to promise
 * @param batchSize - Number of items to process in each batch (default: unlimited)
 * @returns Promise that resolves to array of results in original order
 */
export async function processBatches<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  batchSize?: number
): Promise<R[]> {
  // If no batch size specified, process all at once
  if (!batchSize || batchSize <= 0 || batchSize >= items.length) {
    const promises = items.map((item, index) => processor(item, index));
    return Promise.all(promises);
  }

  const results: R[] = new Array(items.length);

  // Process items in batches
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchPromises = batch.map((item, batchIndex) => {
      const originalIndex = i + batchIndex;
      return processor(item, originalIndex).then((result) => ({
        result,
        originalIndex,
      }));
    });

    const batchResults = await Promise.all(batchPromises);

    // Place results in correct positions
    for (const { result, originalIndex } of batchResults) {
      results[originalIndex] = result;
    }
  }

  return results;
}

/**
 * Chunks an array into smaller arrays of specified size
 *
 * @param array - Array to chunk
 * @param chunkSize - Size of each chunk
 * @returns Array of chunks
 */
export function chunk<T>(array: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    return [array];
  }

  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}
