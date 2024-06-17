/* eslint-disable @typescript-eslint/naming-convention */
import { ColorLog } from '../util/log.js';

import type { AxFieldValue, AxProgramUsage } from './program.js';
import type { AxField } from './sig.js';

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

export const validateValue = (
  field: Readonly<AxField>,
  value: Readonly<AxFieldValue>
): void => {
  const ft = field.type ?? { name: 'string', isArray: false };

  const validateSingleValue = (
    expectedType: string,
    val: Readonly<AxFieldValue>
  ): boolean => {
    switch (expectedType) {
      case 'string':
        return typeof val === 'string';
      case 'number':
        return typeof val === 'number';
      case 'boolean':
        return typeof val === 'boolean';
      default:
        return false; // Unknown or unsupported type
    }
  };

  let isValid = true;
  if (ft.isArray) {
    if (!Array.isArray(value)) {
      isValid = false;
    } else {
      for (const item of value) {
        if (!validateSingleValue(ft.name, item)) {
          isValid = false;
          break;
        }
      }
    }
  } else {
    isValid = validateSingleValue(ft.name, value);
  }

  if (!isValid) {
    throw new Error(
      `Validation failed: Expected '${field.name}' to be a ${ft.isArray ? 'an array of ' : ''}${
        ft.name
      } instead got '${value}'`
    );
  }
};

export function mergeProgramUsage(
  usages: readonly AxProgramUsage[]
): AxProgramUsage[] {
  const usageMap: { [key: string]: AxProgramUsage } = {};

  usages.forEach((usage) => {
    const key = `${usage.ai}:${usage.model}`;

    if (!usageMap[key]) {
      usageMap[key] = { ...usage };
      return;
    }

    usageMap[key]!.promptTokens += usage.promptTokens;
    usageMap[key]!.completionTokens += usage.completionTokens;
    usageMap[key]!.totalTokens += usage.totalTokens;
  });

  return Object.values(usageMap);
}
