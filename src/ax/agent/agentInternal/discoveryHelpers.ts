import {
  compareCanonicalDiscoveryStrings,
  normalizeDiscoveryCallableIdentifier,
} from '../runtimeDiscovery.js';
import type {
  AxAgentDiscoveryPromptState,
  AxDiscoveryTurnSummary,
  AxMutableDiscoveryPromptState,
} from './types.js';

export function createMutableDiscoveryPromptState(): AxMutableDiscoveryPromptState {
  return {
    modules: new Map<string, string>(),
    functions: new Map<string, string>(),
  };
}

export function restoreDiscoveryPromptState(
  state?: Readonly<AxAgentDiscoveryPromptState>
): AxMutableDiscoveryPromptState {
  const restored = createMutableDiscoveryPromptState();

  for (const entry of state?.modules ?? []) {
    if (
      entry &&
      typeof entry.module === 'string' &&
      entry.module.trim() &&
      typeof entry.text === 'string' &&
      entry.text.trim()
    ) {
      restored.modules.set(entry.module.trim(), entry.text.trim());
    }
  }

  for (const entry of state?.functions ?? []) {
    if (
      entry &&
      typeof entry.qualifiedName === 'string' &&
      entry.qualifiedName.trim() &&
      typeof entry.text === 'string' &&
      entry.text.trim()
    ) {
      restored.functions.set(
        normalizeDiscoveryCallableIdentifier(entry.qualifiedName),
        entry.text.trim()
      );
    }
  }

  return restored;
}

/**
 * Merge one stage's discovered docs into another's. Used at the pipeline's
 * phase boundary so tool docs the distiller loaded arrive pre-populated in
 * the executor (mirroring how recalled memories already carry over), keeping
 * the "only re-run discovery for modules not listed" dedupe honest.
 */
export function mergeDiscoveryPromptStateInto(
  target: AxMutableDiscoveryPromptState,
  source: Readonly<AxMutableDiscoveryPromptState>
): void {
  for (const [module, text] of source.modules) {
    target.modules.set(module, text);
  }
  for (const [qualifiedName, text] of source.functions) {
    target.functions.set(qualifiedName, text);
  }
}

export function serializeDiscoveryPromptState(
  state: Readonly<AxMutableDiscoveryPromptState>
): AxAgentDiscoveryPromptState | undefined {
  const modules = [...state.modules.entries()]
    .sort(([left], [right]) => compareCanonicalDiscoveryStrings(left, right))
    .map(([module, text]) => ({ module, text }));
  const functions = [...state.functions.entries()]
    .sort(([left], [right]) => compareCanonicalDiscoveryStrings(left, right))
    .map(([qualifiedName, text]) => ({ qualifiedName, text }));

  if (modules.length === 0 && functions.length === 0) {
    return undefined;
  }

  return {
    ...(modules.length > 0 ? { modules } : {}),
    ...(functions.length > 0 ? { functions } : {}),
  };
}

export function renderDiscoveryPromptMarkdown(
  state: Readonly<AxMutableDiscoveryPromptState>
): string | undefined {
  const modules = [...state.modules.entries()]
    .sort(([left], [right]) => compareCanonicalDiscoveryStrings(left, right))
    .map(([, text]) => text);
  const functions = [...state.functions.entries()]
    .sort(([left], [right]) => compareCanonicalDiscoveryStrings(left, right))
    .map(([, text]) => text);
  const rendered = [...modules, ...functions].filter(Boolean).join('\n\n');

  return rendered || undefined;
}

export function createDiscoveryTurnSummary(): AxDiscoveryTurnSummary {
  return {
    modules: new Set<string>(),
    functions: new Set<string>(),
    texts: new Set<string>(),
  };
}

export function formatDiscoveryTurnSummary(
  summary: Readonly<AxDiscoveryTurnSummary>
): string | undefined {
  const parts: string[] = [];
  const modules = [...summary.modules].sort(compareCanonicalDiscoveryStrings);
  const functions = [...summary.functions].sort(
    compareCanonicalDiscoveryStrings
  );

  if (modules.length > 0) {
    parts.push(
      `Discovery docs now available for modules: ${modules.join(', ')}`
    );
  }
  if (functions.length > 0) {
    parts.push(
      `Discovery docs now available for functions: ${functions.join(', ')}`
    );
  }

  return parts.join('\n') || undefined;
}

export function stripDiscoveryTurnOutput(
  output: string,
  discoveryTexts: readonly string[]
): string {
  if (discoveryTexts.length === 0) {
    return output;
  }

  let sanitized = output;
  const orderedTexts = [...new Set(discoveryTexts)]
    .filter((text) => text.trim().length > 0)
    .sort((left, right) => {
      if (left.length !== right.length) {
        return right.length - left.length;
      }
      return compareCanonicalDiscoveryStrings(left, right);
    });

  for (const text of orderedTexts) {
    sanitized = sanitized.split(text).join('');
  }

  sanitized = sanitized.replace(/\n{3,}/g, '\n\n').trim();
  return sanitized || '(no output)';
}

export function appendDiscoveryTurnSummary(
  output: string,
  discoveryTurnSummary: string | undefined
): string {
  if (!discoveryTurnSummary) {
    return output;
  }

  const trimmedOutput = output.trimEnd();
  return trimmedOutput && trimmedOutput !== '(no output)'
    ? `${trimmedOutput}\n\n${discoveryTurnSummary}`
    : discoveryTurnSummary;
}
