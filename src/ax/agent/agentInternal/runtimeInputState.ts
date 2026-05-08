import { DEFAULT_RLM_MAX_LLM_CALLS } from '../config.js';
import {
  buildContextFieldPromptInlineValue,
  buildRLMVariablesInfo,
} from '../runtime.js';
import type { AxAgentRuntimeInputState } from './agentInternalTypes.js';

export function createRuntimeInputState(
  self: any,
  values: any,
  options?: Readonly<{
    allowedFieldNames?: readonly string[];
    validateInputKeys?: boolean;
  }>
): AxAgentRuntimeInputState {
  const s = self as any;
  const rawValues: Record<string, unknown> =
    (values as Record<string, unknown>) ?? {};

  const allowedFieldNames = options?.allowedFieldNames
    ? new Set(options.allowedFieldNames)
    : undefined;
  if (allowedFieldNames && options?.validateInputKeys) {
    for (const key of Object.keys(rawValues)) {
      if (!allowedFieldNames.has(key)) {
        throw new Error(
          `AxAgent.test() only accepts context field values. "${key}" is not configured in contextFields.`
        );
      }
    }
  }

  const currentInputs: Record<string, unknown> = { ...rawValues };
  const signatureInputFieldNames = allowedFieldNames
    ? new Set<string>(allowedFieldNames)
    : new Set<string>(
        s.program
          .getSignature()
          .getInputFields()
          .map((f: { name: string }) => f.name)
      );

  let contextValues: Record<string, unknown> = {};
  let nonContextValues: Record<string, unknown> = {};
  let actorInlineContextValues: Record<string, unknown> = {};
  let contextMetadata: string | undefined;

  const optionalContextFields = new Set<string>(
    s.program
      .getSignature()
      .getInputFields()
      .filter(
        (f: { name: string; isOptional?: boolean }) =>
          s.rlmConfig.contextFields.includes(f.name) && f.isOptional
      )
      .map((f: { name: string }) => f.name)
  );

  const recomputeTurnInputs = (validateRequiredContext: boolean): void => {
    const nextContextValues: Record<string, unknown> = {};
    const nextNonContextValues: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(currentInputs)) {
      if (s.rlmConfig.contextFields.includes(k)) {
        nextContextValues[k] = v;
      } else {
        nextNonContextValues[k] = v;
      }
    }

    if (validateRequiredContext) {
      for (const field of s.rlmConfig.contextFields) {
        if (optionalContextFields.has(field)) {
          continue;
        }
        if (
          !(field in nextContextValues) ||
          nextContextValues[field] === undefined
        ) {
          throw new Error(
            `RLM contextField "${field}" is missing from input values`
          );
        }
      }
    }

    const nextInlineContextValues: Record<string, unknown> = {};
    for (const [field, promptConfig] of s.contextPromptConfigByField) {
      if (!(field in nextContextValues)) {
        continue;
      }
      const inlined = buildContextFieldPromptInlineValue(
        nextContextValues[field],
        promptConfig
      );
      if (inlined !== undefined) {
        nextInlineContextValues[field] = inlined;
      }
    }

    contextValues = nextContextValues;
    nonContextValues = nextNonContextValues;
    actorInlineContextValues = nextInlineContextValues;

    contextMetadata =
      buildRLMVariablesInfo(contextValues, {
        promptConfigByField: s.contextPromptConfigByField,
        inlinedFields: new Set(Object.keys(actorInlineContextValues)),
      }) || undefined;
  };

  return {
    currentInputs,
    signatureInputFieldNames,
    recomputeTurnInputs,
    getNonContextValues: () => nonContextValues,
    getActorInlineContextValues: () => actorInlineContextValues,
    getContextMetadata: () => contextMetadata,
  };
}

export function ensureLlmQueryBudgetState(self: any): boolean {
  const s = self as any;
  if (s.llmQueryBudgetState) {
    return false;
  }

  const globalMax = s.rlmConfig.maxSubAgentCalls ?? DEFAULT_RLM_MAX_LLM_CALLS;
  // Root agent uses globalMax as its local limit (only children are capped)
  s.llmQueryBudgetState = {
    global: { used: 0 },
    globalMax,
    localUsed: 0,
    localMax: globalMax,
  };
  return true;
}
