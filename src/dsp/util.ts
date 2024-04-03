import chalk from 'chalk';

export const dedup = (seq: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const x of seq) {
    if (!seen.has(x)) {
      seen.add(x);
      result.push(x);
    }
  }

  return result;
};

export const updateProgressBar = (
  current: number,
  total: number,
  success: number,
  elapsedTime: number, // in seconds
  progressBarWidth: number = 20, // Default width of the progress bar
  msg: string
): void => {
  const percentage = ((current / total) * 100).toFixed(1);
  const filledBarLength = Math.round((progressBarWidth * current) / total);
  const emptyBarLength = progressBarWidth - filledBarLength;
  const filledBar = chalk.blueBright('█'.repeat(filledBarLength));
  const emptyBar = ' '.repeat(emptyBarLength);
  const itemsPerSecond =
    elapsedTime > 0 ? (current / elapsedTime).toFixed(2) : '0.00';

  process.stdout.write(
    `\r${msg}: ${current} / ${total}  (${chalk.yellow(percentage)}%): 100%|${filledBar}${emptyBar}| ${success}/${total} [${chalk.red(elapsedTime.toFixed(2))}, ${itemsPerSecond}it/s]`
  );
};
