/**
 * Best-effort static dependency extraction for flow execute mappings.
 *
 * This intentionally never invokes user code. It only recognizes direct state
 * reads that are safe to recognize from function source. Unknown state access is
 * marked unsafe so the planner can keep execution sequential.
 */
export interface AxFlowStateDependencyAnalysis {
  dependencies: string[];
  isSafe: boolean;
}

// Escape hatch for generated mapping closures (e.g. the mermaid compiler's
// table-driven wiring): source sniffing can't see through them, which would
// classify them unsafe and serialize the whole flow. A generator that knows
// its exact reads attaches them under this key.
export const explicitDependenciesKey = Symbol('axFlowExplicitDependencies');

export function analyzeStateDependencyMetadata(
  mapping: ((state: any) => any) | undefined
): AxFlowStateDependencyAnalysis {
  if (!mapping || typeof mapping !== 'function') {
    return { dependencies: [], isSafe: true };
  }

  const explicit = (
    mapping as { [explicitDependenciesKey]?: readonly string[] }
  )[explicitDependenciesKey];
  if (Array.isArray(explicit)) {
    return { dependencies: [...explicit], isSafe: true };
  }

  const source = mapping.toString();
  const destructuredFields = getDestructuredParameterFields(source);
  if (destructuredFields.length > 0) {
    return { dependencies: destructuredFields, isSafe: true };
  }

  const stateParamName = getFirstParameterName(source);
  const dependencies = new Set<string>();

  if (!stateParamName) {
    return { dependencies: [], isSafe: !hasDestructuredParameter(source) };
  }

  const escapedParam = escapeRegExp(stateParamName);

  for (const match of source.matchAll(
    new RegExp(`\\b${escapedParam}\\.(\\w+)`, 'g')
  )) {
    if (match[1]) dependencies.add(match[1]);
  }

  for (const match of source.matchAll(
    new RegExp(`\\$\\{\\s*${escapedParam}\\.(\\w+)`, 'g')
  )) {
    if (match[1]) dependencies.add(match[1]);
  }

  for (const match of source.matchAll(
    new RegExp(`\\{\\s*([\\w\\s,:]+)\\s*\\}\\s*=\\s*${escapedParam}\\b`, 'g')
  )) {
    const fields = match[1]?.split(',') ?? [];
    for (const field of fields) {
      const name = field.trim().split(':')[0]?.trim();
      if (name) dependencies.add(name);
    }
  }

  return {
    dependencies: [...dependencies],
    isSafe:
      dependencies.size > 0 || !usesParameterInBody(source, stateParamName),
  };
}

export function analyzeStateDependencies(
  mapping: ((state: any) => any) | undefined
): string[] {
  return analyzeStateDependencyMetadata(mapping).dependencies;
}

function getFirstParameterName(source: string): string | undefined {
  const functionMatch = source.match(/function[^(]*\(\s*([A-Za-z_$][\w$]*)/);
  if (functionMatch?.[1]) {
    return functionMatch[1];
  }

  const arrowMatch = source.match(
    /^(?:async\s*)?(?:\(\s*)?([A-Za-z_$][\w$]*)\s*(?:[):=,]|\)\s*=>|=>)/
  );
  if (arrowMatch?.[1]) {
    return arrowMatch[1];
  }

  return undefined;
}

function getDestructuredParameterFields(source: string): string[] {
  const match =
    source.match(/function[^(]*\(\s*\{([^}]+)\}/) ??
    source.match(/^(?:async\s*)?\(\s*\{([^}]+)\}/);
  if (!match?.[1]) {
    return [];
  }

  return match[1]
    .split(',')
    .map((field) => field.trim().split(':')[0]?.split('=')[0]?.trim())
    .filter((field): field is string => !!field);
}

function hasDestructuredParameter(source: string): boolean {
  return (
    /function[^(]*\(\s*\{/.test(source) || /^(?:async\s*)?\(\s*\{/.test(source)
  );
}

function usesParameterInBody(source: string, paramName: string): boolean {
  const body = getFunctionBodySource(source);
  return new RegExp(`\\b${escapeRegExp(paramName)}\\b`).test(body);
}

function getFunctionBodySource(source: string): string {
  const arrowIndex = source.indexOf('=>');
  if (arrowIndex >= 0) {
    return source.slice(arrowIndex + 2);
  }

  const bodyIndex = source.indexOf('{');
  if (bodyIndex >= 0) {
    return source.slice(bodyIndex + 1);
  }

  return '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
