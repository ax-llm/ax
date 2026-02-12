import * as _fs from 'node:fs';
import * as _http from 'node:http';
import * as _https from 'node:https';
import * as _os from 'node:os';
import * as _process from 'node:process';
import { runInNewContext } from 'node:vm';
import type { AxFunction } from '@ax-llm/ax';

// Local implementation of getCrypto since it's not exported from main package
function getCrypto() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto;
  }
  throw new Error(
    'Web Crypto API with randomUUID support not available. Requires Node.js 16+ or modern browser.'
  );
}

export enum AxJSInterpreterPermission {
  FS = 'node:fs',
  NET = 'net',
  OS = 'os',
  CRYPTO = 'crypto',
  PROCESS = 'process',
}

type Context = {
  console: Console;
  fs: unknown;
  http: unknown;
  https: unknown;
  os: unknown;
  crypto: unknown;
  process: unknown;
};

export class AxJSInterpreter {
  private permissions: readonly AxJSInterpreterPermission[];
  private timeout: number;

  constructor({
    permissions = [],
    timeout = 30_000,
  }:
    | Readonly<{
        permissions?: readonly AxJSInterpreterPermission[];
        timeout?: number;
      }>
    | undefined = {}) {
    this.permissions = permissions ?? [];
    this.timeout = timeout;
  }

  private codeInterpreterJavascript(
    code: string,
    abortSignal?: AbortSignal
  ): unknown {
    if (abortSignal?.aborted) {
      throw new Error(
        `Aborted: ${abortSignal.reason ?? 'Interpreter execution aborted'}`
      );
    }

    const context: Partial<Context> = { console };

    if (this.permissions.includes(AxJSInterpreterPermission.FS)) {
      context.fs = _fs;
    }

    if (this.permissions.includes(AxJSInterpreterPermission.NET)) {
      context.http = _http;
      context.https = _https;
    }

    if (this.permissions.includes(AxJSInterpreterPermission.OS)) {
      context.os = _os;
    }

    if (this.permissions.includes(AxJSInterpreterPermission.CRYPTO)) {
      context.crypto = getCrypto();
    }

    if (this.permissions.includes(AxJSInterpreterPermission.PROCESS)) {
      context.process = _process;
    }

    return runInNewContext(`(function() { ${code} })()`, context, {
      timeout: this.timeout,
    });
  }

  public toFunction(): AxFunction {
    return {
      name: 'javascriptInterpreter',
      description:
        'Use this function to run Javascript code and get any expected return value',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'JS code with a return value in the end.',
          },
        },
        required: ['code'],
      },

      func: (
        { code }: Readonly<{ code: string }>,
        extra?: Parameters<AxFunction['func']>[1]
      ) => this.codeInterpreterJavascript(code, extra?.abortSignal),
    };
  }
}

// Factory function following the same pattern as MCP
export function axCreateJSInterpreter(
  options?: Readonly<{
    permissions?: readonly AxJSInterpreterPermission[];
    timeout?: number;
  }>
): AxJSInterpreter {
  return new AxJSInterpreter(options);
}
