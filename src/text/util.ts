import crypto from 'crypto';

import Ajv, { JSONSchemaType } from 'ajv';
import JSON5 from 'json5';

const ajv = new Ajv();

export const stringToObject = <T>(text: string, schema: unknown): T => {
  try {
    const obj = JSON5.parse<T>(text);
    ajv.validate(schema as JSONSchemaType<T>, obj);
    return obj as T;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    throw new Error((e as Error).message.replace(/^JSON5:/, ''));
  }
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
