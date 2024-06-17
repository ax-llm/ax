import * as _crypto from 'crypto';
import * as _fs from 'fs';
import * as _http from 'http';
import * as _https from 'https';
import * as _os from 'os';
import * as _process from 'process';
import { runInNewContext } from 'vm';

import type { AxFunction } from '../ai/index.js';

export const axJSInterpreterFunction = (
  permissions: readonly AxCodeInterpreterPermission[] = []
): AxFunction => ({
  name: 'jsInterpreter',
  description: 'Run Javascript code',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JS code with a return value in the end.'
      }
    },
    required: ['code']
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  func: ({ code }: Readonly<{ code: string }>): Promise<any> => {
    return new Promise((resolve) => {
      resolve(codeInterpreterJavascript(code, permissions));
    });
  }
});

export enum AxCodeInterpreterPermission {
  FS = 'fs',
  NET = 'net',
  OS = 'os',
  CRYPTO = 'crypto',
  PROCESS = 'process'
}

const codeInterpreterJavascript = (
  code: string,
  permissions: readonly AxCodeInterpreterPermission[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context: { [key: string]: any } = {
    // require: require,
    console: console
  };

  if (permissions.includes(AxCodeInterpreterPermission.FS)) {
    context.fs = _fs;
  }

  if (permissions.includes(AxCodeInterpreterPermission.NET)) {
    context.http = _http;
    context.https = _https;
  }

  if (permissions.includes(AxCodeInterpreterPermission.OS)) {
    context.os = _os;
  }

  if (permissions.includes(AxCodeInterpreterPermission.CRYPTO)) {
    context.crypto = _crypto;
  }

  if (permissions.includes(AxCodeInterpreterPermission.PROCESS)) {
    context.process = _process;
  }

  // executing code within the sandbox
  return runInNewContext(`(function() { ${code} })()`, context);
};
