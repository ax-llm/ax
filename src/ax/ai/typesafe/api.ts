// cspell:ignore noul jev systemone
import { validateValueDescriptions } from '../../dsp/valueDescriptions.js';
import type { AxAPI } from '../../util/apicall.js';
import { AxBaseAI } from '../base.js';
import {
  axGetAIProfile,
  axResolveAIProfileFeatures,
} from '../provider_profiles.js';
import type {
  AxAICredentialProvider,
  AxAIInputModelList,
  AxAIServiceOptions,
  AxChatResponse,
  AxInternalChatRequest,
  AxModelConfig,
  AxModelInfo,
} from '../types.js';
import type {
  AxAITypesafeChoiceQuestion,
  AxAITypesafeNoulQuestion,
  AxAITypesafeRequest,
} from './types.js';
import {
  decodeTypesafeResponse,
  typesafeProbability as probability,
  typesafeRecord as record,
  validateTypesafeRequest,
} from './validate.js';

/** Typesafe evaluates typed questions; it does not generate freeform text. */
export type AxAITypesafeArgs<TModelKey = string> = {
  name: 'typesafe';
  apiKey?: string;
  credentialProvider?: AxAICredentialProvider;
  apiURL?: string;
  config?: { model?: string };
  options?: Readonly<AxAIServiceOptions>;
  models?: AxAIInputModelList<string, never, TModelKey>;
  modelInfo?: AxModelInfo[];
  /** Convert a Noul probability to true at or above this value. Default: 0.5. */
  trueThreshold?: number;
};

type QuestionPlan = {
  name: string;
  question: AxAITypesafeNoulQuestion | AxAITypesafeChoiceQuestion;
};

type Request = AxAITypesafeRequest & { model: string };

class TypesafeImpl {
  private readonly threshold: number;

  constructor(args: Pick<AxAITypesafeArgs, 'trueThreshold'>) {
    this.threshold = probability(args.trueThreshold ?? 0.5, 'trueThreshold');
  }

  getModelConfig(): AxModelConfig {
    return { stream: false };
  }
  getTokenUsage(): undefined {
    return undefined;
  }

  validateChatReq(req: Readonly<AxInternalChatRequest<string>>): void {
    if (
      req.functions?.length ||
      (req.functionCall && req.functionCall !== 'none')
    ) {
      throw new Error(
        'Typesafe does not support tools; use a generative provider for tool execution'
      );
    }
    if (req.modelConfig?.n !== undefined && req.modelConfig.n !== 1) {
      throw new Error('Typesafe does not support multiple completion samples');
    }
    if (req.modelConfig?.audio) {
      throw new Error('Typesafe supports text input only');
    }
    for (const message of req.chatPrompt) {
      if (
        message.role === 'function' ||
        (message.role === 'assistant' &&
          (message.functionCalls?.length ||
            message.audio ||
            message.images?.length))
      ) {
        throw new Error('Typesafe does not support tool or media history');
      }
      if (
        message.role === 'user' &&
        Array.isArray(message.content) &&
        message.content.some((part) => part.type !== 'text')
      ) {
        throw new Error('Typesafe supports text input only');
      }
    }
    for (const [key, value] of Object.entries(req.modelConfig ?? {})) {
      if (value !== undefined && key !== 'stream' && key !== 'n')
        throw new Error(
          `Typesafe does not support generation control "${key}"`
        );
    }
    const plan = this.plan(req);
    validateTypesafeRequest({
      model: req.model,
      state: null,
      questions: Object.fromEntries(
        plan.map(({ name, question }) => [name, question])
      ),
    });
  }

  private plan(req: Readonly<AxInternalChatRequest<string>>): QuestionPlan[] {
    if (req.responseFormat?.type !== 'json_schema') {
      throw new Error(
        'Typesafe requires an output schema. Use ax() with required boolean or class outputs'
      );
    }
    const wrapper = record(req.responseFormat.schema, 'responseFormat.schema');
    const schema = record(wrapper.schema, 'output schema');
    if (
      schema.type !== 'object' ||
      schema.anyOf ||
      schema.oneOf ||
      schema.allOf ||
      schema.$ref
    ) {
      throw new Error('Typesafe requires a flat object output schema');
    }
    const properties = record(schema.properties, 'output properties');
    const required = schema.required;
    if (!Object.keys(properties).length)
      throw new Error('Typesafe requires at least one output field');
    return Object.entries(properties).map(([name, value]) => {
      const field = record(value, `field ${name}`);
      const unsupported = () =>
        new Error(
          `Typesafe cannot evaluate output "${name}". Use required boolean or class fields; use typesafe().systemOne() for scoring, or a generative provider for other outputs`
        );
      if (
        !Array.isArray(required) ||
        !required.includes(name) ||
        field.anyOf ||
        field.oneOf ||
        field.allOf ||
        field.$ref ||
        field.const !== undefined
      )
        throw unsupported();
      const annotation = req.responseFormat?.fieldDescriptions?.[name];
      if (annotation) {
        record(annotation, `field description ${name}`);
        record(annotation.valueDescriptions, `value descriptions for ${name}`);
        if (
          annotation.description !== undefined &&
          typeof annotation.description !== 'string'
        )
          throw new Error(`Typesafe: description for ${name} must be a string`);
        validateValueDescriptions(
          field.type === 'string' && Array.isArray(field.enum)
            ? 'class'
            : String(field.type),
          annotation.valueDescriptions,
          field.enum as string[] | undefined,
          name
        );
      }
      const description = annotation
        ? annotation.description
        : field.description;
      const instructions =
        typeof description === 'string' && description
          ? `${name}: ${description}`
          : `Evaluate the output field ${name}.`;
      if (field.type === 'boolean' && !field.enum) {
        return {
          name,
          question: {
            type: 'noul',
            instructions,
            ...(annotation
              ? { criteria: { ...annotation.valueDescriptions } }
              : {}),
          },
        };
      }
      if (
        field.type === 'string' &&
        Array.isArray(field.enum) &&
        field.enum.length > 0 &&
        field.enum.every((value) => typeof value === 'string') &&
        new Set(field.enum).size === field.enum.length
      ) {
        return {
          name,
          question: {
            type: 'choice',
            instructions,
            criteria: Object.fromEntries(
              field.enum.map((value) => [
                value,
                annotation && Object.hasOwn(annotation.valueDescriptions, value)
                  ? annotation.valueDescriptions[value]
                  : null,
              ])
            ),
          },
        };
      }
      throw unsupported();
    });
  }

  createChatReq(
    req: Readonly<AxInternalChatRequest<string>>
  ): [AxAPI, Request] {
    this.validateChatReq(req);
    const plan = this.plan(req);
    const messages = req.chatPrompt.map((message) => ({
      role: message.role,
      content:
        message.role === 'function'
          ? message.result
          : typeof message.content === 'string'
            ? message.content
            : message.role === 'user'
              ? message.content
                  .map((part) => (part.type === 'text' ? part.text : ''))
                  .join('\n')
              : '',
    }));
    return [
      { name: '/v1/systemone' },
      {
        model: req.model,
        state: { messages },
        questions: Object.fromEntries(
          plan.map(({ name, question }) => [name, question])
        ),
      },
    ];
  }

  createChatResp(
    raw: unknown,
    req?: Readonly<AxInternalChatRequest<string>>
  ): AxChatResponse {
    if (!req)
      throw new Error('Typesafe response decoding requires its request');
    const plan = this.plan(req);
    const response = decodeTypesafeResponse(
      raw,
      Object.fromEntries(plan.map(({ name, question }) => [name, question]))
    );
    const entries = plan.map(({ name }) => {
      const answer = response.answers[name]!;
      return [
        name,
        answer.type === 'noul' ? answer.noul >= this.threshold : answer.choice,
      ];
    });
    return {
      results: [
        {
          index: 0,
          content: JSON.stringify(Object.fromEntries(entries)),
          finishReason: 'stop',
        },
      ],
      modelUsage: {
        ai: 'Typesafe',
        model: response.model,
        tokens: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens:
            response.usage.input_tokens + response.usage.output_tokens,
        },
      },
      providerMetadata: { typesafe: { answers: response.answers } },
    };
  }
}

/** Native Typesafe System One transport, with Ax retries, cancellation and usage. */
export class AxAITypesafe<TModelKey = string> extends AxBaseAI<
  string,
  never,
  Request,
  never,
  unknown,
  never,
  never,
  TModelKey
> {
  constructor(args: Readonly<AxAITypesafeArgs<TModelKey>>) {
    if (!args.apiKey?.trim() && !args.credentialProvider)
      throw new Error('Typesafe requires apiKey or credentialProvider');
    const profile = axGetAIProfile('typesafe');
    const model = args.config?.model ?? profile.defaultModel!;
    super(new TypesafeImpl(args), {
      name: 'Typesafe',
      profile: 'typesafe',
      apiURL: args.apiURL ?? profile.baseURL,
      headers: async (): Promise<Record<string, string>> =>
        args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {},
      credentialProvider: args.credentialProvider,
      modelInfo: args.modelInfo ?? [],
      defaults: { model },
      options: args.options,
      models: args.models,
      supportFor: () => axResolveAIProfileFeatures('typesafe', model),
    });
  }
}
