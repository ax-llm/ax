import type {
  AxAIService,
  AxFunction,
  AxFunctionJSONSchema,
} from '../ai/types.js';
import { parseFunctions } from './functions.js';
import type { AxSelfTuningConfig, AxStepContext } from './types.js';

const THINKING_BUDGET_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'highest',
] as const;

/**
 * Creates the `adjustGeneration` self-tuning function dynamically
 * based on the AI service's model list and the provided config.
 */
export function createSelfTuningFunction(
  ai: Readonly<AxAIService>,
  config: AxSelfTuningConfig
): AxFunction {
  const properties: Record<
    string,
    AxFunctionJSONSchema & { enum?: string[]; description: string }
  > = {};

  // Build model property from ai.getModelList()
  if (config.model !== false) {
    const modelList = ai.getModelList();
    if (modelList && modelList.length > 0) {
      // Filter to chat models only (entries with 'model' field, not 'embedModel')
      const chatModels = modelList.filter((entry) => 'model' in entry);
      if (chatModels.length > 0) {
        const enumValues = chatModels.map((m) => m.key as string);
        const descParts = chatModels.map(
          (m) => `${m.key as string} (${m.description})`
        );
        properties.model = {
          type: 'string',
          enum: enumValues,
          description: `Switch model for the next step. Prefer faster/cheaper models for simple tasks; use more capable models for complex reasoning, math, or multi-step analysis. Available: ${descParts.join(', ')}`,
        };
      }
    }
  }

  // Build thinkingBudget property
  if (config.thinkingBudget !== false) {
    properties.thinkingBudget = {
      type: 'string',
      enum: [...THINKING_BUDGET_LEVELS],
      description:
        'Reasoning depth for the next step. none/minimal: simple lookups or reformatting. low/medium: moderate analysis, summarization. high/highest: math, logic, code analysis, or multi-step reasoning. Higher budgets use more tokens.',
    };
  }

  // Build temperature property
  if (config.temperature) {
    properties.temperature = {
      type: 'number',
      description:
        'Sampling temperature for the next step. Lower values (0–0.3) for deterministic tasks like math or code; higher values (0.7–1.0) for creative or exploratory tasks.',
    };
  }

  // Build addFunctions/removeFunctions from function pool
  let parsedPool: AxFunction[] | undefined;
  if (config.functions && config.functions.length > 0) {
    parsedPool = parseFunctions(config.functions);
    const funcNames = parsedPool.map((f) => f.name);
    const funcDescs = parsedPool.map((f) => `${f.name} (${f.description})`);

    properties.addFunctions = {
      type: 'array',
      items: { type: 'string', enum: funcNames },
      description: `Activate tools you need for the current sub-task. Only add what you will use immediately — fewer active tools means less noise. Available: ${funcDescs.join(', ')}`,
    };

    properties.removeFunctions = {
      type: 'array',
      items: { type: 'string', enum: funcNames },
      description:
        'Remove tools you are done with to reduce context size and maintain focus on remaining work.',
    };
  }

  // Capture pool reference for the handler closure
  const pool = parsedPool;

  const func: AxFunction = {
    name: 'adjustGeneration',
    description:
      'Adjust model, reasoning depth, or active tools for the next step. Call when task complexity changes — upgrade for hard reasoning or analysis, downgrade for simple follow-ups. Only call when there is a clear reason to change.',
    parameters:
      Object.keys(properties).length > 0
        ? {
            type: 'object',
            properties,
          }
        : undefined,
    func: (
      args?: {
        model?: string;
        thinkingBudget?: string;
        temperature?: number;
        addFunctions?: string[];
        removeFunctions?: string[];
      },
      extra?: { step?: AxStepContext }
    ) => {
      const step = extra?.step;
      if (!step) {
        return 'Generation parameters adjusted for next response.';
      }

      if (args?.model) {
        step.setModel(args.model);
      }
      if (args?.thinkingBudget) {
        step.setThinkingBudget(
          args.thinkingBudget as (typeof THINKING_BUDGET_LEVELS)[number]
        );
      }
      if (args?.temperature !== undefined) {
        step.setTemperature(args.temperature);
      }
      if (args?.addFunctions?.length && pool) {
        const toAdd = pool.filter((f) => args.addFunctions!.includes(f.name));
        if (toAdd.length > 0) {
          step.addFunctions(toAdd);
        }
      }
      if (args?.removeFunctions?.length) {
        step.removeFunctions(...args.removeFunctions);
      }

      return 'Generation parameters adjusted for next response.';
    },
  };

  return func;
}
