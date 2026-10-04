// Bound parallel fixture processes without changing case selection or order.
export function conformanceWorkers(
  value = process.env.AXIR_CONFORMANCE_WORKERS
) {
  if (value === undefined || value === '') return 1;
  const workers = Number(value);
  if (!Number.isInteger(workers) || workers < 1 || workers > 32) {
    throw new Error('AXIR_CONFORMANCE_WORKERS must be an integer from 1 to 32');
  }
  return workers;
}

export async function mapConformanceCases(
  cases,
  run,
  workers = conformanceWorkers()
) {
  const results = new Array(cases.length);
  let next = 0;
  let failure;
  let failed = false;
  const tasks = Array.from(
    { length: Math.min(workers, cases.length) },
    async () => {
      while (!failed && next < cases.length) {
        const index = next++;
        try {
          results[index] = await run(cases[index], index);
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
      }
    }
  );
  // Wait for active processes before callers remove their working directories.
  await Promise.all(tasks);
  if (failed) throw failure;
  return results;
}
