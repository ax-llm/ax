import crypto from 'crypto';

import Ajv, { JSONSchemaType } from 'ajv';
import JSON5 from 'json5';

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

export const stringToObject = <T>(text: string, schema: unknown): T => {
  const obj = JSON5.parse<T>(text);
  ajv.validate(schema as JSONSchemaType<T>, obj);
  return obj as T;
};

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
