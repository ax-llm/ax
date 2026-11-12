import type { AxNativeDecision } from '../../dsp/decision.js';
// cspell:ignore noul
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
import { axModelInfoGoogleGeminiDecisions } from './info.js';
import { decisionsPrompt } from './prompt.js';
import type {
  AxAIGoogleGeminiDecisionQuestion,
  AxAIGoogleGeminiDecisionsRequest,
} from './types.js';
import {
  decodeDecisionsResponse,
  decisionProbability as probability,
  decisionRecord as record,
  validateDecisionsRequest,
} from './validate.js';

/** Google Gemini Decisions evaluates typed questions; it does not generate freeform text. */
export type AxAIGoogleGeminiDecisionsArgs<TModelKey = string> = {
  name: 'google-gemini-decisions';
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
  question: AxAIGoogleGeminiDecisionQuestion;
};

type Request = AxAIGoogleGeminiDecisionsRequest & { model: string };

class GeminiDecisionsImpl {
  private readonly threshold: number;

  constructor(args: Pick<AxAIGoogleGeminiDecisionsArgs, 'trueThreshold'>) {
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
        'Google Gemini Decisions does not support tools; use a generative provider for tool execution'
      );
    }
    if (req.modelConfig?.n !== undefined && req.modelConfig.n !== 1) {
      throw new Error(
        'Google Gemini Decisions does not support multiple completion samples'
      );
    }
    for (const [key, value] of Object.entries(req.modelConfig ?? {})) {
      if (value !== undefined && key !== 'stream' && key !== 'n')
        throw new Error(
          `Google Gemini Decisions does not support generation control "${key}"`
        );
    }
    const plan = this.plan(req);
    validateDecisionsRequest({
      model: req.model,
      input: decisionsPrompt(req),
      questions: Object.fromEntries(
        plan.map(({ name, question }) => [name, question])
      ),
    });
  }

  private plan(req: Readonly<AxInternalChatRequest<string>>): QuestionPlan[] {
    if (req.responseFormat?.type !== 'json_schema') {
      throw new Error(
        'Google Gemini Decisions requires an output schema. Use ax() with required boolean, class or rubric score outputs'
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
      throw new Error(
        'Google Gemini Decisions requires a flat object output schema'
      );
    }
    const properties = record(schema.properties, 'output properties');
    const required = schema.required;
    if (!Object.keys(properties).length)
      throw new Error(
        'Google Gemini Decisions requires at least one output field'
      );
    return Object.entries(properties).map(([name, value]) => {
      const wireField = record(value, `field ${name}`);
      const decision = req.responseFormat?.decisionFields?.[name];
      if (decision?.isArray || decision?.isOptional)
        throw new Error(
          'Decision providers require flat, required scalar outputs'
        );
      const field = decision
        ? {
            ...wireField,
            type: decision.type === 'class' ? 'string' : decision.type,
            enum: decision.type === 'class' ? decision.options : undefined,
            anyOf: undefined,
          }
        : wireField;
      const unsupported = () =>
        new Error(
          `Google Gemini Decisions cannot evaluate output "${name}". Use required boolean, class or rubric score fields, or a generative provider for other outputs`
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
            `Google Gemini Decisions: description for ${name} must be a string`
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
      if (decision?.type === 'box')
        throw new Error('Google Gemini Decisions does not support box outputs');
      if (decision?.type === 'score') {
        return {
          name,
          question: {
            type: 'score' as const,
            instructions,
            criteria: decision.options as [string, string, ...string[]],
          },
        };
      }
      if (field.type === 'boolean' && !field.enum) {
        return {
          name,
          question: {
            type: 'noul',
            instructions,
            ...(annotation
              ? {
                  criteria: Object.fromEntries(
                    Object.entries(annotation.valueDescriptions).map(
                      ([k, v]) => [`${k}_description`, v]
                    )
                  ),
                }
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
                  : '',
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
    const request: Request = {
      model: req.model,
      input: decisionsPrompt(req),
      questions: Object.fromEntries(
        plan.map(({ name, question }) => [name, question])
      ),
    };
    return [{ name: '/decisions' }, request];
  }

  createChatResp(
    raw: unknown,
    req?: Readonly<AxInternalChatRequest<string>>
  ): AxChatResponse {
    if (!req)
      throw new Error(
        'Google Gemini Decisions response decoding requires its request'
      );
    const plan = this.plan(req);
    const response = decodeDecisionsResponse(
      raw,
      Object.fromEntries(plan.map(({ name, question }) => [name, question]))
    );
    const native: Record<string, AxNativeDecision> = {};
    const entries = plan.map(({ name }) => {
      const answer = response.answers[name]!;
      if (req.responseFormat?.decisionFields?.[name]) {
        if (answer.type === 'noul') {
          native[name] = { confidence: answer.confidence };
          return [name, { probability: answer.noul }];
        }
        if (answer.type === 'score') {
          native[name] = { value: answer.score, confidence: answer.confidence };
          return [
            name,
            {
              probabilities: Object.keys(answer.probabilities)
                .sort((a, b) => Number(a) - Number(b))
                .map((k) => answer.probabilities[k]),
            },
          ];
        }
        native[name] = { value: answer.choice, confidence: answer.confidence };
        return [name, { probabilities: answer.probabilities }];
      }
      return [
        name,
        answer.type === 'noul'
          ? answer.noul >= this.threshold
          : answer.type === 'choice'
            ? answer.choice
            : answer.score,
      ];
    });
    return {
      results: [
        {
          index: 0,
          ...(Object.keys(native).length
            ? {
                decisionContext: {
                  provenance: {
                    source: 'native' as const,
                    provider: 'Google Gemini Decisions',
                    model: req.model,
                  },
                  native,
                },
              }
            : {}),
          content: JSON.stringify(Object.fromEntries(entries)),
          finishReason: 'stop',
        },
      ],
      modelUsage: {
        ai: 'Google Gemini Decisions',
        model: req.model,
        tokens: {
          promptTokens: response.usage.total_input_tokens,
          completionTokens: response.usage.total_output_tokens,
          totalTokens:
            response.usage.total_input_tokens +
            response.usage.total_output_tokens,
        },
      },
      providerMetadata: {
        googleGeminiDecisions: {
          answers: response.answers,
          usage: response.usage,
        },
      },
    };
  }
}

/** Native Google Gemini Decisions transport, with Ax retries, cancellation and usage. */
export class AxAIGoogleGeminiDecisions<TModelKey = string> extends AxBaseAI<
  string,
  never,
  Request,
  never,
  unknown,
  never,
  never,
  TModelKey
> {
  constructor(args: Readonly<AxAIGoogleGeminiDecisionsArgs<TModelKey>>) {
    if (!args.apiKey?.trim() && !args.credentialProvider)
      throw new Error(
        'Google Gemini Decisions requires apiKey or credentialProvider'
      );
    const profile = axGetAIProfile('google-gemini-decisions');
    const model = args.config?.model ?? profile.defaultModel!;
    super(new GeminiDecisionsImpl(args), {
      name: 'Google Gemini Decisions',
      profile: 'google-gemini-decisions',
      apiURL: args.apiURL ?? profile.baseURL,
      headers: async (): Promise<Record<string, string>> =>
        args.apiKey ? { 'x-goog-api-key': args.apiKey } : {},
      credentialProvider: args.credentialProvider,
      modelInfo: args.modelInfo ?? axModelInfoGoogleGeminiDecisions,
      defaults: { model },
      options: args.options,
      models: args.models,
      supportFor: () =>
        axResolveAIProfileFeatures('google-gemini-decisions', model),
    });
  }
}
