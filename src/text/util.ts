import { AITokenUsage } from './index';

export function log(msg: string, color: string) {
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
}

export const addUsage = (u1: AITokenUsage, u2?: AITokenUsage) => {
  u1.promptTokens += u2?.promptTokens || 0;
  u1.completionTokens += u2?.completionTokens || 0;
  u1.totalTokens += u2?.totalTokens || 0;
};
