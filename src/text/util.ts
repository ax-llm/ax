import crypto from 'crypto';

export function uuid(): string {
  return ('1e7' + -1e3 + -4e3 + -8e3 + -1e11).replace(
    /[018]/g,
    (c: string): string => {
      const cryptoObj =
        crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4));
      return (Number(c) ^ cryptoObj).toString(16);
    }
  );
}
