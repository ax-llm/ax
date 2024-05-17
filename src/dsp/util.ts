import { ColorLog } from '../util/log.js';

const colorLog = new ColorLog();

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
  const filledBar = colorLog.blueBright('█'.repeat(filledBarLength));
  const emptyBar = ' '.repeat(emptyBarLength);
  const itemsPerSecond =
    elapsedTime > 0 ? (current / elapsedTime).toFixed(2) : '0.00';

  process.stdout.write(
    `\r${msg}: ${current} / ${total}  (${colorLog.yellow(percentage)}%): 100%|${filledBar}${emptyBar}| Success: ${success}/${total} [${colorLog.red(elapsedTime.toFixed(2))}, ${itemsPerSecond}it/s]`
  );
};
