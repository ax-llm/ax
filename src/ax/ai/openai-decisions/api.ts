import { validateValueDescriptions } from '../../dsp/valueDescriptions.js';
import type { AxAPI } from '../../util/apicall.js';
import { AxBaseAI } from '../base.js';
import { axNormalizeOpenAIUsage } from '../openai/usage.js';
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
import { axModelInfoOpenAIDecisions } from './info.js';
import type {
  AxAIOpenAIDecisionInputPart,
  AxAIOpenAIDecisionQuestion,
  AxAIOpenAIDecisionsRequest,
} from './types.js';
import {
  decisionProbability,
  decodeDecisionsResponse,
  decisionRecord as record,
  validateDecisionsRequest,
} from './validate.js';

export type AxAIOpenAIDecisionsArgs<TModelKey = string> = {
  name: 'openai-decisions';
  apiKey?: string;
  credentialProvider?: AxAICredentialProvider;
  /** Base URL including /v1. Defaults to https://api.openai.com/v1. */
  apiURL?: string;
  config?: { model?: string };
  options?: Readonly<AxAIServiceOptions>;
  models?: AxAIInputModelList<string, never, TModelKey>;
  modelInfo?: AxModelInfo[];
  /** Predicate probabilities at or above this value become true. Default: 0.5. */
  trueThreshold?: number;
  safetyIdentifier?: string;
};
type QuestionPlan = { name: string; question: AxAIOpenAIDecisionQuestion };
type Request = AxAIOpenAIDecisionsRequest & { model: string };
class DecisionsImpl {
  private readonly threshold: number;
  constructor(
    private readonly args: Readonly<
      Pick<AxAIOpenAIDecisionsArgs, 'trueThreshold' | 'safetyIdentifier'>
    >
  ) {
    this.threshold = decisionProbability(
      args.trueThreshold ?? 0.5,
      'trueThreshold'
    );
  }
  getModelConfig(): AxModelConfig {
    return { stream: false };
  }
  getTokenUsage(): undefined {
    return undefined;
  }
  validateChatReq(req: Readonly<AxInternalChatRequest<string>>): void {
    this.payload(req);
  }
  private plan(req: Readonly<AxInternalChatRequest<string>>): QuestionPlan[] {
    if (req.responseFormat?.type !== 'json_schema') {
      throw new Error(
        'OpenAI Decisions requires an output schema. Use ax() with required boolean or class outputs'
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
      throw new Error('OpenAI Decisions requires a flat object output schema');
    }
    const properties = record(schema.properties, 'output properties');
    const required = schema.required;
    if (!Object.keys(properties).length)
      throw new Error('OpenAI Decisions requires at least one output field');
    return Object.entries(properties).map(([name, value]) => {
      const field = record(value, `field ${name}`);
      const unsupported = () =>
        new Error(
          `OpenAI Decisions cannot evaluate output "${name}". Use required boolean or class fields; use openaiDecisions().create() for scoring, or a generative provider for other outputs`
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
          throw new Error(
            `OpenAI Decisions: description for ${name} must be a string`
          );
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
            type: 'predicate',
            instructions: annotation
              ? [
                  instructions,
                  ...Object.entries(annotation.valueDescriptions).map(
                    ([value, description]) => `${value}: ${description}`
                  ),
                ].join('\n')
              : instructions,
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
            choices: field.enum.map((value) => ({
              value,
              ...(annotation &&
              Object.hasOwn(annotation.valueDescriptions, value)
                ? { description: annotation.valueDescriptions[value] }
                : {}),
            })),
          },
        };
      }
      throw unsupported();
    });
  }

  private payload(req: Readonly<AxInternalChatRequest<string>>): Request {
    if (
      req.functions?.length ||
      (req.functionCall && req.functionCall !== 'none')
    )
      throw new Error('OpenAI Decisions does not support tools');
    for (const [key, value] of Object.entries(req.modelConfig ?? {})) {
      if (
        value !== undefined &&
        key !== 'stream' &&
        !(key === 'n' && value === 1)
      )
        throw new Error(
          `OpenAI Decisions does not support generation control "${key}"`
        );
    }
    const parts: AxAIOpenAIDecisionInputPart[] = [];
    for (const message of req.chatPrompt) {
      if (
        message.role === 'function' ||
        (message.role === 'assistant' &&
          (message.functionCalls?.length ||
            message.audio ||
            message.images?.length))
      )
        throw new Error(
          'OpenAI Decisions does not support tool or media history'
        );
      parts.push({ type: 'input_text', text: `${message.role}:` });
      if (typeof message.content === 'string')
        parts.push({ type: 'input_text', text: message.content });
      else if (message.role === 'user') {
        for (const part of message.content) {
          if (part.type === 'text')
            parts.push({ type: 'input_text', text: part.text });
          else if (part.type === 'image')
            parts.push({
              type: 'input_image',
              image_url: part.image.startsWith('data:')
                ? part.image
                : `data:${part.mimeType};base64,${part.image}`,
              ...(part.details ? { detail: part.details } : {}),
            });
          else
            throw new Error(
              'OpenAI Decisions supports text and inline images only'
            );
        }
      }
    }
    const payload: Request = {
      model: req.model,
      input: [{ role: 'user', content: parts }],
      questions: this.plan(req).map(({ name, question }) => ({
        ...question,
        name,
      })),
      ...(this.args.safetyIdentifier
        ? { safety_identifier: this.args.safetyIdentifier }
        : {}),
    };
    validateDecisionsRequest(payload);
    return payload;
  }
  createChatReq(
    req: Readonly<AxInternalChatRequest<string>>
  ): [AxAPI, Request] {
    return [{ name: '/decisions' }, this.payload(req)];
  }
  createChatResp(
    raw: unknown,
    req?: Readonly<AxInternalChatRequest<string>>
  ): AxChatResponse {
    if (!req)
      throw new Error(
        'OpenAI Decisions response decoding requires its request'
      );
    const questions = this.plan(req).map(({ name, question }) => ({
      ...question,
      name,
    }));
    const response = decodeDecisionsResponse(raw, questions);
    const entries = response.answers.map((answer) => {
      if (answer.type === 'refusal')
        throw new Error(`OpenAI Decisions refused question "${answer.name}"`);
      if (answer.type === 'score')
        throw new Error('OpenAI Decisions scoring requires the native client');
      return [
        answer.name,
        answer.type === 'predicate'
          ? answer.probability >= this.threshold
          : answer.choice,
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
        ai: 'OpenAI Decisions',
        model: response.model,
        tokens: axNormalizeOpenAIUsage(response.usage)!,
      },
      providerMetadata: { openaiDecisions: { answers: response.answers } },
    };
  }
}
/** Dedicated Decisions endpoint for required boolean/class signatures. */
export class AxAIOpenAIDecisions<TModelKey = string> extends AxBaseAI<
  string,
  never,
  Request,
  never,
  unknown,
  never,
  never,
  TModelKey
> {
  constructor(args: Readonly<AxAIOpenAIDecisionsArgs<TModelKey>>) {
    if (!args.apiKey?.trim() && !args.credentialProvider)
      throw new Error('OpenAI Decisions requires apiKey or credentialProvider');
    const profile = axGetAIProfile('openai-decisions');
    const model = args.config?.model ?? profile.defaultModel!;
    super(new DecisionsImpl(args), {
      name: 'OpenAI Decisions',
      profile: 'openai-decisions',
      apiURL: args.apiURL ?? profile.baseURL,
      headers: async (): Promise<Record<string, string>> =>
        args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {},
      credentialProvider: args.credentialProvider,
      modelInfo: args.modelInfo ?? axModelInfoOpenAIDecisions,
      defaults: { model },
      options: args.options,
      models: args.models,
      supportFor: () => axResolveAIProfileFeatures('openai-decisions', model),
    });
  }
}
