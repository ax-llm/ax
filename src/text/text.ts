import { z, ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  Memory,
  AIService,
  AIMemory,
  PromptConfig,
  AIGenerateTextResponse,
} from './index.js';

import { AIGenerateTextExtraOptions } from './types.js';

import { log, addUsage } from './util.js';
import { processAction, buildActionsPrompt } from './actions.js';

export type Options = {
  sessionID?: string;
  mem?: AIMemory;
};

/**
 * The main class for various text generation tasks
 * @export
 */
export class AIPrompt<T> {
  private conf: PromptConfig;
  private maxSteps = 20;
  private debug = false;

  constructor(conf: PromptConfig) {
    this.conf = conf;
  }

  setMaxSteps(maxSteps: number) {
    this.maxSteps = maxSteps;
  }

  setDebug(debug: boolean) {
    this.debug = debug;
  }

  create(
    _query: string,
    _system: string,
    _history: () => string,
    _ai: AIService
  ): string {
    return '';
  }

  generate(
    ai: AIService,
    query: string,
    { sessionID, mem }: Options = {}
  ): Promise<AIGenerateTextResponse<T>> {
    return new Promise((resolve) => {
      const res = this._generate(ai, mem || new Memory(), query, sessionID);
      resolve(res);
    });
  }

  private async _generate(
    ai: AIService,
    mem: AIMemory,
    query: string,
    sessionID?: string
  ): Promise<AIGenerateTextResponse<T>> {
    const { conf } = this;
    const { responseConfig, actions } = conf;
    const { keyValue, schema } = responseConfig || {};

    const extraOptions = {
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      usageEmbed: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      sessionID,
      debug: this.debug,
    };

    let res: AIGenerateTextResponse<string>;

    if (actions && actions?.length > 0) {
      res = await this._generateWithActions(ai, mem, query, extraOptions);
    } else {
      res = await this._generateDefault(ai, mem, query, extraOptions);
    }

    let fvalue:
      | string
      | Map<string, string[]>
      | z.infer<ZodType<any, any, any>>;
    let value = res.value();
    let error: { message: string } | null = null;

    for (let i = 0; i < 3; i++) {
      try {
        if (keyValue) {
          fvalue = stringToMap(value);
        } else if (schema) {
          fvalue = stringToObject<T>(value, schema);
        } else {
          fvalue = value;
        }

        return {
          ...res,
          usage: extraOptions.usage,
          usageEmbed: extraOptions.usageEmbed,
          value: () => fvalue,
        };
      } catch (e: any) {
        value = await this.fixSyntax(ai, mem, e, value, extraOptions);
        error = e;
      }
    }
    throw new Error(`invalid response syntax: ${error?.message}`);
  }

  private async _generateWithActions(
    ai: AIService,
    mem: AIMemory,
    query: string,
    { usage, usageEmbed, sessionID, debug }: AIGenerateTextExtraOptions
  ): Promise<AIGenerateTextResponse<string>> {
    const { conf } = this;
    const { actions } = conf;
    const { schema } = conf.responseConfig || {};

    conf.stopSequences = [...conf.stopSequences, 'Observation:'];
    const h = () => mem.history(sessionID);

    const sprompt: string = buildActionsPrompt(
      actions || [],
      buildSchemaPrompt(schema)
    );

    let done = false;

    for (let i = 0; i < this.maxSteps; i++) {
      let p = this.create(query, sprompt, h, ai);

      // remove leading spaces to improve prompt readability
      if (this.debug) {
        p = p.replace(/^[ \t]+/gm, '');
      }

      if (debug) {
        log(`> ${p}`, 'white');
      }

      const res = await ai.generate(p, conf, sessionID);
      const rval = res.value().trim();

      if (debug) {
        log(`< ${rval}`, 'red');
      }

      if (rval.length === 0) {
        throw new Error('empty response from ai');
      }

      addUsage(usage, res.usage);

      done = await processAction(conf, ai, mem, res, {
        usage,
        usageEmbed,
        sessionID,
        debug,
      });
      if (done) {
        return res;
      }
    }

    throw new Error(`query uses over max number of steps: ${this.maxSteps}`);
  }

  private async _generateDefault(
    ai: AIService,
    mem: AIMemory,
    query: string,
    { usage, sessionID, debug }: AIGenerateTextExtraOptions
  ): Promise<AIGenerateTextResponse<string>> {
    const { conf } = this;
    const { schema } = conf.responseConfig || {};

    const h = () => mem.history(sessionID);
    const sprompt: string = buildSchemaPrompt(schema);

    let p = this.create(query, sprompt, h, ai);

    // remove leading spaces to improve prompt readability
    if (this.debug) {
      p = p.replace(/^[ \t]+/gm, '');
    }

    if (debug) {
      log(`> ${p}`, 'white');
    }

    const res = await ai.generate(p, conf, sessionID);
    const rval = res.value().trim();

    if (debug) {
      log(`< ${rval}`, 'red');
    }

    addUsage(usage, res.usage);

    const mval = [this.conf.queryPrefix, query, this.conf.responsePrefix, rval];
    mem.add(mval.join(''), sessionID);
    return res;
  }

  private async fixSyntax(
    ai: AIService,
    mem: AIMemory,
    error: Error,
    value: string,
    { usage, sessionID, debug }: AIGenerateTextExtraOptions
  ): Promise<string> {
    const { conf } = this;
    const p = `${mem.history()}\nSyntax Error: ${error.message}\n${value}`;
    const res = await ai.generate(p, conf, sessionID);
    const rval = res.value().trim();

    if (debug) {
      log(`Syntax Error: ${error.message}`, 'red');
      log(`< ${rval}`, 'red');
    }

    addUsage(usage, res.usage);
    return rval;
  }
}

const stringToObject = <T>(text: string, schema: z.ZodType): T => {
  let obj: any;

  try {
    obj = JSON.parse(text);
  } catch (e: any) {
    throw new Error(e);
  }

  if (obj.schema) {
    obj = obj.schema;
  }

  if (obj.error) {
    throw new Error(obj.error);
  }

  try {
    schema.parse(obj);
  } catch (error: any) {
    throw new Error(error);
  }

  return obj;
};

const stringToMap = (text: string): Map<string, string[]> => {
  const vm = new Map<string, string[]>();
  const re = /([a-zA-Z ]+):\s{0,}\n?(((?!N\/A).)+)$/gm;

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // This is necessary to avoid infinite loops with zero-width matches
    if (m.index === re.lastIndex) {
      re.lastIndex++;
    }
    vm.set(m[1], m[2].split(','));
  }
  if (vm.size === 0) {
    throw new Error('Expected format is a list of key: value');
  }
  return vm;
};

const buildSchemaPrompt = (schema?: z.ZodType<any, any, any>): string => {
  if (!schema) {
    return '';
  }
  const jsonSchema = JSON.stringify(zodToJsonSchema(schema, 'schema'));
  return `JSON SCHEMA:"""\n${jsonSchema}\n"""\n`;
};
