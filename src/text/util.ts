import Ajv, { JSONSchemaType } from 'ajv';
import JSON5 from 'json5';

import { AITokenUsage } from './types.js';

const ajv = new Ajv();

export function log(msg: string, color: string): null {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (typeof window === 'undefined') {
    if (color === 'red') {
      color = '\x1b[93m';
    }
    if (color === 'cyan') {
      color = '\x1b[96m';
    }
    if (color === 'white') {
      color = '\x1b[37;1m';
    }
    console.log(`${color}${msg}\x1b[0m\n`);
  } else {
    console.log(`%c${msg}`, { color });
  }
  return null;
}

export const _addUsage = (
  usage: readonly AITokenUsage[],
  u: Readonly<AITokenUsage>
): AITokenUsage[] => {
  const index = usage.findIndex((v) => v.model.id === u.model.id);
  if (index === -1) {
    return [...usage, u];
  }

  if (u.stats) {
    const u1 = usage[index];
    const s = u1.stats;
    const stats = s
      ? {
          promptTokens: s.promptTokens + u.stats.promptTokens,
          completionTokens: s.completionTokens + u.stats.completionTokens,
          totalTokens: s.totalTokens + u.stats.totalTokens,
        }
      : u.stats;

    return [
      ...usage.slice(0, index),
      { ...u, stats },
      ...usage.slice(index + 1),
    ];
  }

  return [...usage];
};

export const updateUsage = (
  // eslint-disable-next-line functional/prefer-immutable-types
  usage: AITokenUsage[],
  u: Readonly<AITokenUsage>
) => {
  usage.forEach((u1, i) => {
    if (u1.model.id === u.model.id) {
      usage[i] = u;
    }
  });
};

export const addUsage = (
  usage: readonly AITokenUsage[],
  uList: readonly AITokenUsage[]
): AITokenUsage[] => {
  let newUsage = [...usage];
  uList.forEach((u) => {
    newUsage = _addUsage(newUsage, u);
  });
  return newUsage as AITokenUsage[];
};

export const stringToObject = <T>(text: string, schema: unknown): T => {
  const obj = JSON5.parse<T>(text);
  ajv.validate(schema as JSONSchemaType<T>, obj);
  return obj as T;
};
