import type { AxIField } from '../../dsp/sig.js';
import { DEFAULT_RLM_MAX_LLM_CALLS } from '../config.js';
import {
  buildContextFieldPromptInlineValue,
  buildRLMVariablesInfo,
  fieldAcceptsStringPreview,
} from '../runtime.js';
import type {
  AxAgentAutoPromotionRecord,
  AxAgentRuntimeInputState,
} from './agentInternalTypes.js';
import type { AxContextFieldPromptConfig } from './agentStateTypes.js';

/**
 * Pipeline- and loop-owned input fields that must never be auto-promoted to
 * runtime-only context: truncating them would break the stage contract (the
 * executor request, evidence descriptors, carried metadata) rather than slim
 * an oversized user value.
 */
export const AUTO_PROMOTION_RESERVED_FIELDS = new Set([
  'executorRequest',
  'distilledContextSummary',
  'contextMetadata',
  'memories',
  // Defensive: actor-loop prompt fields. They are assembled per turn rather
  // than passed as run inputs today, but must never promote if that changes.
  'contextMap',
  'discoveredToolDocs',
  'loadedSkills',
  'relevanceHints',
  'summarizedActorLog',
  'guidanceLog',
  'actionLog',
  'liveRuntimeState',
  'contextPressure',
  'contextData',
]);

type AutoPromotionDecision = {
  mode: 'preview' | 'stringifiedPreview' | 'omit';
  size: number;
  stringified?: string;
};

const metadataLineFieldName = (line: string): string | undefined =>
  /^- ([^:]+):/.exec(line)?.[1];

/**
 * Merge the handoff `contextMetadata` (distiller lines carried into the
 * executor stage in shared-session mode) with the locally computed lines.
 * Local lines win per field; handoff-only lines are kept first.
 */
function mergeContextMetadata(
  handoff: string | undefined,
  local: string
): string {
  if (!handoff) {
    return local;
  }
  if (!local) {
    return handoff;
  }
  const localLines = local.split('\n');
  const localNames = new Set(
    localLines
      .map(metadataLineFieldName)
      .filter((name): name is string => Boolean(name))
  );
  const keptHandoff = handoff.split('\n').filter((line) => {
    const name = metadataLineFieldName(line);
    return !name || !localNames.has(name);
  });
  return [...keptHandoff, ...localLines].join('\n');
}

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

  // ----- Auto-upgrade: oversized undeclared values become runtime-only -----
  const autoContextConfig = s.autoUpgrade?.contextFields as
    | { enabled: boolean; promoteAboveChars: number; previewChars: number }
    | undefined;
  const autoContextEnabled = autoContextConfig?.enabled === true;
  const inputFieldByName = new Map<string, AxIField>(
    s.program
      .getSignature()
      .getInputFields()
      .map((f: AxIField) => [f.name, f])
  );
  // Decisions are memoized per field per value identity so promotion status
  // can't flap between per-turn recomputes and JSON.stringify runs at most
  // once per value.
  const promotionDecisions = new Map<
    string,
    { value: unknown; decision: AutoPromotionDecision | undefined }
  >();
  const announcedPromotions = new Set<string>();
  const pendingPromotionEvents: AxAgentAutoPromotionRecord[] = [];

  const decideAutoPromotion = (
    field: string,
    value: unknown
  ): AutoPromotionDecision | undefined => {
    if (!autoContextEnabled || !autoContextConfig) {
      return undefined;
    }
    if (AUTO_PROMOTION_RESERVED_FIELDS.has(field)) {
      return undefined;
    }
    if (value === undefined || value === null) {
      return undefined;
    }
    const promoteAboveChars = autoContextConfig.promoteAboveChars;
    if (typeof value === 'string' && value.length <= promoteAboveChars) {
      return undefined;
    }
    const memo = promotionDecisions.get(field);
    if (memo && memo.value === value) {
      return memo.decision;
    }

    let stringified: string | undefined;
    let size: number;
    if (typeof value === 'string') {
      size = value.length;
    } else {
      try {
        stringified = JSON.stringify(value);
      } catch {
        stringified = undefined;
      }
      size = stringified?.length ?? String(value).length;
    }

    let decision: AutoPromotionDecision | undefined;
    if (size > promoteAboveChars) {
      const inputField = inputFieldByName.get(field);
      if (typeof value === 'string' && fieldAcceptsStringPreview(inputField)) {
        decision = { mode: 'preview', size };
      } else if (
        typeof value !== 'string' &&
        stringified !== undefined &&
        inputField !== undefined &&
        fieldAcceptsStringPreview(inputField)
      ) {
        decision = { mode: 'stringifiedPreview', size, stringified };
      } else if (inputField === undefined || inputField.isOptional) {
        decision = { mode: 'omit', size };
      } else {
        // Required field that can't take a string preview (array, object,
        // number, media): leave it inline — omitting would fail the
        // required-input check and a stub would fail type validation.
        decision = undefined;
      }
    }
    promotionDecisions.set(field, { value, decision });
    return decision;
  };

  const recomputeTurnInputs = (validateRequiredContext: boolean): void => {
    const nextContextValues: Record<string, unknown> = {};
    const nextNonContextValues: Record<string, unknown> = {};
    const effectivePromptConfigByField = new Map<
      string,
      AxContextFieldPromptConfig
    >(s.contextPromptConfigByField);
    const stringifiedPreviewSources = new Map<string, string>();

    for (const [k, v] of Object.entries(currentInputs)) {
      if (s.rlmConfig.contextFields.includes(k)) {
        nextContextValues[k] = v;
        continue;
      }
      const decision = decideAutoPromotion(k, v);
      if (decision) {
        nextContextValues[k] = v;
        if (decision.mode !== 'omit') {
          effectivePromptConfigByField.set(k, {
            kind: 'truncate',
            keepInPromptChars: autoContextConfig!.previewChars,
            reverseTruncate: false,
          });
          if (decision.stringified !== undefined) {
            stringifiedPreviewSources.set(k, decision.stringified);
          }
        }
        if (!announcedPromotions.has(k)) {
          announcedPromotions.add(k);
          pendingPromotionEvents.push({
            fieldName: k,
            originalChars: decision.size,
            ...(decision.mode === 'omit'
              ? {}
              : { promptPreviewChars: autoContextConfig!.previewChars }),
          });
        }
        continue;
      }
      nextNonContextValues[k] = v;
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
    for (const [field, promptConfig] of effectivePromptConfigByField) {
      if (!(field in nextContextValues)) {
        continue;
      }
      const inlined = buildContextFieldPromptInlineValue(
        stringifiedPreviewSources.get(field) ?? nextContextValues[field],
        promptConfig
      );
      if (inlined !== undefined) {
        nextInlineContextValues[field] = inlined;
      }
    }

    contextValues = nextContextValues;
    nonContextValues = nextNonContextValues;
    actorInlineContextValues = nextInlineContextValues;

    const localVariablesInfo = buildRLMVariablesInfo(contextValues, {
      promptConfigByField: effectivePromptConfigByField,
      inlinedFields: new Set(Object.keys(actorInlineContextValues)),
    });
    // In shared-session mode the executor stage receives the distiller's
    // contextMetadata as a plain input; merge instead of clobbering it so
    // phase-1 context variables stay described alongside local promotions.
    const handoffMetadata =
      typeof currentInputs.contextMetadata === 'string' &&
      currentInputs.contextMetadata.trim()
        ? currentInputs.contextMetadata
        : undefined;
    contextMetadata =
      mergeContextMetadata(handoffMetadata, localVariablesInfo) || undefined;
  };

  return {
    currentInputs,
    signatureInputFieldNames,
    recomputeTurnInputs,
    getNonContextValues: () => nonContextValues,
    getActorInlineContextValues: () => actorInlineContextValues,
    getContextMetadata: () => contextMetadata,
    drainAutoPromotionEvents: () =>
      pendingPromotionEvents.splice(0, pendingPromotionEvents.length),
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
