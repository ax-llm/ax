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
