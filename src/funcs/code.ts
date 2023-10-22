import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import https from 'https';
import os from 'os';
import vm from 'vm';

import { PromptFunction } from '../prompts';

export const JSInterpreterFunction = (
  permissions: readonly CodeInterpreterPermission[] = []
): PromptFunction => ({
  name: 'jsInterpreter',
  description: 'Run Javascript code',
  inputSchema: {
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

export enum CodeInterpreterPermission {
  FS = 'fs',
  NET = 'net',
  OS = 'os',
  CRYPTO = 'crypto',
  PROCESS = 'process'
}

export const codeInterpreterJavascript = (
  code: string,
  permissions: readonly CodeInterpreterPermission[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context: { [key: string]: any } = {
    // require: require,
    console: console
  };

  if (permissions.includes(CodeInterpreterPermission.FS)) {
    context.fs = fs;
  }

  if (permissions.includes(CodeInterpreterPermission.NET)) {
    context.http = http;
    context.https = https;
  }

  if (permissions.includes(CodeInterpreterPermission.OS)) {
    context.os = os;
  }

  if (permissions.includes(CodeInterpreterPermission.CRYPTO)) {
    context.crypto = crypto;
  }

  if (permissions.includes(CodeInterpreterPermission.PROCESS)) {
    context.process = process;
  }

  // executing code within the sandbox
  return vm.runInNewContext(`(function() { ${code} })()`, context);
};
