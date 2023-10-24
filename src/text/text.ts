import crypto from 'crypto';

import { JSONSchemaType } from 'ajv';

import { TextResponse } from '../ai/types.js';
import { convertToChatRequest } from '../ai/util.js';
import { DBQueryService } from '../db/types.js';
import {
  AITextChatPromptItem,
  AITextRequestFunction,
  APIError,
  ParsingError
} from '../tracing/types.js';

import { buildFinalResultSchema, FunctionProcessor } from './functions.js';
import { Memory } from './memory.js';
import { parseResult } from './result.js';
import {
  AIMemory,
  AIPromptConfig,
  AIService,
  AIServiceActionOptions,
  AITextResponse,
  PromptConfig
} from './types.js';

export type PromptValues =
  | string
  | AITextChatPromptItem[]
  | { systemPrompt: string; prompt: string };

export type Options = {
  memory?: AIMemory;
  db?: DBQueryService;
};

type InternalOptions = { db?: DBQueryService } & AIPromptConfig &
  AIServiceActionOptions;

/**
 * The main class for various text generation tasks
 * @export
 */
export class AIPrompt<T> {
  private conf: PromptConfig<T>;
  private funcList?: AITextRequestFunction[];
  private funcProcessor?: FunctionProcessor;

  private maxSteps = 10;
  private debug = false;

  constructor(
    conf: Readonly<PromptConfig<T>> = {
      stopSequences: []
    }
  ) {
    this.conf = { ...conf };
    this.debug = conf.debug || false;

    let functions;

    if (this.conf.response?.schema) {
      functions = [buildFinalResultSchema(this.conf.response?.schema)];

      if (!this.conf.functions || this.conf.functions.length === 0) {
        this.conf.functionCall = { name: 'finalResult' };
      }
    }

    if (this.conf.functions && this.conf.functions.length > 0) {
      functions = [...(functions ?? []), ...this.conf.functions];
    }

    if (functions) {
      this.funcProcessor = new FunctionProcessor(functions);
      this.funcList = functions.map((f) => ({
        name: f.name,
        description: f.description,
        parameters: f.inputSchema as JSONSchemaType<unknown>
      }));
    }
  }

  setMaxSteps(maxSteps: number) {
    this.maxSteps = maxSteps;
  }

  setDebug(debug: boolean) {
    this.debug = debug;
  }

  prompt(query: string): PromptValues {
    return query;
  }

  async fetchContext(
    ai: AIService,
    db: DBQueryService,
    query: string,
    options: Readonly<Options & AIServiceActionOptions> = {}
  ): Promise<AITextChatPromptItem | undefined> {
    const { embeddings } = await ai.embed({ texts: [query] }, options);
    if (embeddings.length === 0) {
      return;
    }

    const { matches } = await db.query({
      values: embeddings[0],
      namespace: '',
      table: '',
      columns: []
    });

    const validMatches = matches?.filter(
      (v) => v.metadata?.context !== undefined
    );

    if (!validMatches || validMatches.length === 0) {
      return;
    }

    const result = validMatches
      ?.map(({ metadata }) => Object.entries(metadata ?? {})?.map(([, v]) => v))
      .join('\n');

    return { role: 'user', text: result };
  }

  async generate(
    ai: AIService,
    query: string,
    options: Readonly<Options & AIServiceActionOptions> = {}
  ): Promise<AITextResponse<string | Map<string, string[]> | T>> {
    ai.setOptions({ debug: this.debug });
    const { sessionId, memory, db } = options;
    const { stopSequences } = this.conf;
    const traceId = options.traceId ?? crypto.randomUUID();

    const [, value] = await this._generate(ai, memory || new Memory(), query, {
      db,
      traceId,
      stopSequences
    });

    return {
      sessionId,
      prompt: query,
      value: () => value
    };
  }

  private async _generate(
    ai: AIService,
    mem: AIMemory,
    query: string,
    options: Readonly<InternalOptions>
  ): Promise<[TextResponse, string | Map<string, string[]> | T]> {
    try {
      return await this.generateHandler(ai, mem, query, options);
    } catch (e: unknown) {
      const err = e as APIError | ParsingError | Error;

      if ((err as APIError).request) {
        ai.getTraceResponse()?.setApiError(err as APIError);
      }

      if ((err as ParsingError).value) {
        ai.getTraceResponse()?.setParsingError(err as ParsingError);
      }

      if (ai.traceExists()) {
        ai.logTrace();
      }

      throw err as Error;
    }
  }

  private async generateHandler(
    ai: AIService,
    mem: AIMemory,
    query: string,
    options: Readonly<InternalOptions>
  ): Promise<[TextResponse, string | Map<string, string[]> | T]> {
    const { keyValue = false, schema } = this.conf.response || {};
    const [res, value] = await this.generateWithFunctions(
      ai,
      mem,
      query,
      options
    );

    const finalValue = await parseResult<T>(
      ai,
      options,
      value,
      keyValue,
      schema
    );
    return [res, finalValue];
  }

  private async generateWithFunctions(
    ai: AIService,
    mem: AIMemory,
    query: string,
    options: Readonly<InternalOptions>
  ): Promise<[TextResponse, string]> {
    for (let i = 0; i < this.maxSteps; i++) {
      const prompt = processPrompt(this.prompt(query));

      if (options.db) {
        const context = await this.fetchContext(ai, options.db, query, options);
        if (context) {
          prompt.push(context);
        }
      }

      const history = mem.history(options?.sessionId);
      const chatPrompt = [...prompt, ...history];
      const res = (await ai.chat(
        {
          chatPrompt,
          functions: this.funcList,
          functionCall: this.conf.functionCall
        },
        { ...options, stream: false }
      )) as TextResponse;

      const result = res.results.at(0);
      if (!result) {
        throw { message: `No result found`, value: res };
      }

      mem.add(result, options.sessionId);

      if (!result.functionCall) {
        return [res, result.text ?? ''];
      }

      const fc = result.functionCall;
      const fe = await this.funcProcessor?.processFunction(fc, ai, options);
      if (!fe) {
        throw { message: `Function ${fc.name} not found`, value: res };
      }

      mem.add(
        {
          id: result.id,
          role: 'function',
          name: fc.name,
          text: fe.result ?? ''
        },
        options.sessionId
      );

      if (
        typeof this.conf.functionCall === 'object' &&
        this.conf.functionCall.name !== '' &&
        fc.name.localeCompare(this.conf.functionCall.name) === 0
      ) {
        return [res, fe.result ?? ''];
      }
    }
    throw new Error(`max ${this.maxSteps} steps allowed`);
  }
}

const processPrompt = (pv: Readonly<PromptValues>): AITextChatPromptItem[] => {
  if (typeof pv === 'string') {
    return [{ role: 'system', text: pv }];
  }

  if (typeof pv === 'object') {
    if (Array.isArray(pv)) {
      return pv;
    }

    const cp = convertToChatRequest(
      pv as { systemPrompt: string; prompt: string }
    );

    return cp.chatPrompt ?? [];
  }

  throw new Error(`prompt must be string, chat or a completion prompt`);
};

// const jaccardSimilarity = (sentence1: string, sentence2: string) => {
//   const set1 = new Set(sentence1.split(' '));
//   const set2 = new Set(sentence2.split(' '));
//   const intersection = new Set([...set1].filter((word) => set2.has(word)));
//   const union = new Set([...set1, ...set2]);
//   return intersection.size / union.size;
// };
