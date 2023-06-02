import { AITokenUsage } from './index';

export function log(msg: string, color: string): null {
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

export const addUsage = (
  usage: AITokenUsage[],
  uList: AITokenUsage[]
): AITokenUsage[] => {
  uList.forEach((u) => {
    usage = _addUsage(usage, u);
  });
  return usage;
};

export const _addUsage = (
  usage: AITokenUsage[],
  u: AITokenUsage
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
