import * as _crypto from 'node:crypto'
import * as _fs from 'node:fs'
import * as _http from 'node:http'
import * as _https from 'node:https'
import * as _os from 'node:os'
import * as _process from 'node:process'
import { runInNewContext } from 'node:vm'

import type { AxFunction } from '../ai/types.js'

export enum AxJSInterpreterPermission {
  FS = 'node:fs',
  NET = 'net',
  OS = 'os',
  CRYPTO = 'crypto',
  PROCESS = 'process',
}

type Context = {
  console: Console
  fs: unknown
  http: unknown
  https: unknown
  os: unknown
  crypto: unknown
  process: unknown
}

export class AxJSInterpreter {
  private permissions: readonly AxJSInterpreterPermission[]

  constructor({
    permissions = [],
  }:
    | Readonly<{ permissions?: readonly AxJSInterpreterPermission[] }>
    | undefined = {}) {
    this.permissions = permissions ?? []
  }

  private codeInterpreterJavascript(code: string): unknown {
    const context: Partial<Context> = { console }

    if (this.permissions.includes(AxJSInterpreterPermission.FS)) {
      context.fs = _fs
    }

    if (this.permissions.includes(AxJSInterpreterPermission.NET)) {
      context.http = _http
      context.https = _https
    }

    if (this.permissions.includes(AxJSInterpreterPermission.OS)) {
      context.os = _os
    }

    if (this.permissions.includes(AxJSInterpreterPermission.CRYPTO)) {
      context.crypto = _crypto
    }

    if (this.permissions.includes(AxJSInterpreterPermission.PROCESS)) {
      context.process = _process
    }

    return runInNewContext(`(function() { ${code} })()`, context)
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

      func: ({ code }: Readonly<{ code: string }>) =>
        this.codeInterpreterJavascript(code),
    }
  }
}
