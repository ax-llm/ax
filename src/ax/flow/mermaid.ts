// Mermaid dialect for AxFlow.
//
// This module renders a flow's step graph as a mermaid flowchart whose node
// contracts travel in `%%ax nodeId: <signature>` comment directives — real
// mermaid renderers ignore `%%` comments, so the diagram stays presentable
// while remaining machine-readable. The same dialect is parsed back into a
// runnable flow by flow.fromMermaid().
//
// IMPORTANT: this file must not import runtime values from flow.js (only
// types) — flow.ts imports the renderer/compiler from here, and a value
// import back would create a cycle. Everything the renderer needs is passed
// in as arguments.

import type { AxProgrammable } from '../dsp/types.js';
import type { AxFlowStep, AxFlowStepDecision } from './steps.js';

export interface AxFlowMermaidRenderOptions {
  direction?: 'TD' | 'LR' | 'BT' | 'RL';
}

type RenderContext = {
  readonly statements: string[];
  readonly bindComments: string[];
  readonly emittedNodes: Set<string>;
  readonly emittedEdges: Set<string>;
  readonly stepIds: Map<AxFlowStep, string>;
  readonly diamonds: Map<string, string>;
  readonly counters: Record<string, number>;
};

type FirstIdCapture = { firstId?: string };

// Match `<param>.<node>Result.<field>` accesses regardless of how the
// closure named its state parameter.
const DECISION_SNIFF = /\.([A-Za-z_$][\w$]*)Result\.([A-Za-z_$][\w$]*)/;
const DECISION_VALUE_SNIFF =
  /\.([A-Za-z_$][\w$]*)Result\.([A-Za-z_$][\w$]*)\s*[=!]==?\s*['"]([^'"]+)['"]/;

function titleForNode(id: string): string {
  const spaced = id
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function nextId(ctx: RenderContext, prefix: string): string {
  ctx.counters[prefix] = (ctx.counters[prefix] ?? 0) + 1;
  return `${prefix}${ctx.counters[prefix]}`;
}

// Resolve which (nodeName, field) decides a branch/feedback step: prefer the
// explicit decision recorded by fromMermaid, else best-effort sniff the
// closure source for a `state.<node>Result.<field>` access.
function resolveDecision(
  decision: AxFlowStepDecision | undefined,
  fn: (state: never) => unknown,
  hasNode: (name: string) => boolean
): AxFlowStepDecision | undefined {
  if (decision && hasNode(decision.nodeName)) {
    return decision;
  }
  const source = String(fn);
  const valueMatch = DECISION_VALUE_SNIFF.exec(source);
  if (valueMatch?.[1] && valueMatch[2] && hasNode(valueMatch[1])) {
    return {
      nodeName: valueMatch[1],
      field: valueMatch[2],
      value: valueMatch[3],
    };
  }
  const match = DECISION_SNIFF.exec(source);
  if (match?.[1] && match[2] && hasNode(match[1])) {
    return { nodeName: match[1], field: match[2] };
  }
  return undefined;
}

// Pre-scan every step (including nested bodies) so decision nodes can be
// drawn as diamonds when their node statement is first emitted.
function collectDiamonds(
  steps: readonly AxFlowStep[],
  nodePrograms: ReadonlyMap<string, unknown>,
  diamonds: Map<string, string>,
  visited: Set<readonly AxFlowStep[]>
): void {
  if (visited.has(steps)) {
    return;
  }
  visited.add(steps);
  for (const step of steps) {
    const meta = step.meta;
    if (!meta) {
      continue;
    }
    if (meta.kind === 'branch') {
      const decision = resolveDecision(meta.decision, meta.predicate, (n) =>
        nodePrograms.has(n)
      );
      if (decision) {
        diamonds.set(decision.nodeName, decision.field);
      }
      for (const [, branchSteps] of meta.branches) {
        collectDiamonds(branchSteps, nodePrograms, diamonds, visited);
      }
    } else if (meta.kind === 'feedback') {
      const decision = resolveDecision(meta.decision, meta.condition, (n) =>
        nodePrograms.has(n)
      );
      if (decision) {
        diamonds.set(decision.nodeName, decision.field);
      }
    } else if (meta.kind === 'while') {
      collectDiamonds(meta.bodySteps, nodePrograms, diamonds, visited);
    }
  }
}

function ensureNodeStatement(
  ctx: RenderContext,
  id: string,
  shape: 'rect' | 'round',
  label?: string
): void {
  if (ctx.emittedNodes.has(id)) {
    return;
  }
  const diamondField = ctx.diamonds.get(id);
  let statement: string;
  if (diamondField !== undefined) {
    statement = `${id}{${diamondField}}`;
  } else if (shape === 'round') {
    statement = `${id}([${label ?? id}])`;
  } else {
    statement = `${id}[${label ?? titleForNode(id)}]`;
  }
  ctx.statements.push(`  ${statement}`);
  ctx.emittedNodes.add(id);
}

function emitEdge(
  ctx: RenderContext,
  from: string,
  to: string,
  label?: string
): void {
  const key = `${from}|${to}|${label ?? ''}`;
  if (ctx.emittedEdges.has(key)) {
    return;
  }
  ctx.emittedEdges.add(key);
  ctx.statements.push(
    label !== undefined
      ? `  ${from} -->|${label}| ${to}`
      : `  ${from} --> ${to}`
  );
}

function producersFromReads(
  ctx: RenderContext,
  reads: readonly string[]
): string[] {
  const producers: string[] = [];
  for (const read of reads) {
    if (read.endsWith('Result')) {
      const producer = read.slice(0, -'Result'.length);
      if (ctx.emittedNodes.has(producer)) {
        producers.push(producer);
      }
    }
  }
  return producers;
}

// Emits a node plus its incoming edges; returns the node id. `pendingLabel`
// labels the edge from the frontier (used for branch `when` values).
function emitStepNode(
  ctx: RenderContext,
  step: AxFlowStep,
  id: string,
  shape: 'rect' | 'round',
  label: string | undefined,
  frontier: readonly string[],
  pendingLabel: string | undefined,
  capture: FirstIdCapture | undefined
): void {
  ensureNodeStatement(ctx, id, shape, label);
  ctx.stepIds.set(step, id);
  if (capture && capture.firstId === undefined) {
    capture.firstId = id;
  }
  if (pendingLabel !== undefined) {
    for (const from of frontier) {
      emitEdge(ctx, from, id, pendingLabel);
    }
    return;
  }
  const producers = producersFromReads(ctx, step.reads).filter((p) => p !== id);
  if (producers.length > 0) {
    for (const producer of producers) {
      emitEdge(ctx, producer, id);
    }
    return;
  }
  for (const from of frontier) {
    if (from !== id) {
      emitEdge(ctx, from, id);
    }
  }
}

function walkSteps(
  ctx: RenderContext,
  steps: readonly AxFlowStep[],
  initialFrontier: readonly string[],
  materializeParallelBranch: (
    branchFn: (subContext: unknown) => unknown
  ) => readonly AxFlowStep[],
  entryLabel?: string,
  capture?: FirstIdCapture
): string[] {
  let frontier = [...initialFrontier];
  let pendingLabel = entryLabel;

  for (const step of steps) {
    switch (step.kind) {
      case 'execute': {
        const id = step.nodeName ?? nextId(ctx, 'node');
        emitStepNode(
          ctx,
          step,
          id,
          'rect',
          undefined,
          frontier,
          pendingLabel,
          capture
        );
        pendingLabel = undefined;
        frontier = [id];
        break;
      }
      case 'derive': {
        const id = nextId(ctx, 'derive');
        const outField = step.writes[0] ?? 'value';
        emitStepNode(
          ctx,
          step,
          id,
          'round',
          `derive ${outField}`,
          frontier,
          pendingLabel,
          capture
        );
        pendingLabel = undefined;
        frontier = [id];
        break;
      }
      case 'map': {
        const name = step.meta?.kind === 'map' ? step.meta.name : undefined;
        const id = name ?? nextId(ctx, 'map');
        emitStepNode(
          ctx,
          step,
          id,
          'round',
          name ?? 'map',
          frontier,
          pendingLabel,
          capture
        );
        if (!name) {
          ctx.bindComments.push(
            `  %% bind nodes.${id} to a function on import`
          );
        }
        pendingLabel = undefined;
        frontier = [id];
        break;
      }
      case 'returns': {
        if (step.meta?.kind === 'returns' && step.meta.synthetic) {
          break;
        }
        const id = nextId(ctx, 'returns');
        emitStepNode(
          ctx,
          step,
          id,
          'round',
          'returns',
          frontier,
          pendingLabel,
          capture
        );
        ctx.bindComments.push(`  %% bind nodes.${id} to a function on import`);
        pendingLabel = undefined;
        frontier = [id];
        break;
      }
      case 'branch': {
        if (step.meta?.kind !== 'branch') {
          break;
        }
        const meta = step.meta;
        const decision = resolveDecision(meta.decision, meta.predicate, (n) =>
          ctx.emittedNodes.has(n)
        );
        let decisionId: string;
        if (decision) {
          decisionId = decision.nodeName;
        } else {
          decisionId = nextId(ctx, 'branch');
          ctx.diamonds.set(decisionId, 'decision');
          ensureNodeStatement(ctx, decisionId, 'rect');
          for (const from of frontier) {
            emitEdge(ctx, from, decisionId, pendingLabel);
          }
          ctx.bindComments.push(
            `  %% bind conditions for ${decisionId} on import (predicate not derivable)`
          );
        }
        pendingLabel = undefined;
        const tails: string[] = [];
        for (const [value, branchSteps] of meta.branches) {
          const branchFrontier = walkSteps(
            ctx,
            branchSteps,
            [decisionId],
            materializeParallelBranch,
            String(value)
          );
          for (const tail of branchFrontier) {
            if (!tails.includes(tail)) {
              tails.push(tail);
            }
          }
        }
        frontier = tails.length > 0 ? tails : [decisionId];
        break;
      }
      case 'while': {
        if (step.meta?.kind !== 'while') {
          break;
        }
        const meta = step.meta;
        const conditionName = meta.conditionName ?? nextId(ctx, 'cond');
        const bodyCapture: FirstIdCapture = {};
        const bodyFrontier = walkSteps(
          ctx,
          meta.bodySteps,
          frontier,
          materializeParallelBranch,
          pendingLabel,
          bodyCapture
        );
        pendingLabel = undefined;
        if (bodyCapture.firstId && bodyFrontier.length > 0) {
          for (const tail of bodyFrontier) {
            emitEdge(
              ctx,
              tail,
              bodyCapture.firstId,
              `while ${conditionName}, max ${meta.maxIterations}`
            );
          }
          if (!meta.conditionName) {
            ctx.bindComments.push(
              `  %% bind conditions.${conditionName} on import`
            );
          }
        }
        frontier = bodyFrontier;
        break;
      }
      case 'feedback': {
        if (step.meta?.kind !== 'feedback') {
          break;
        }
        const meta = step.meta;
        const firstStep = meta.bodySteps[0];
        const lastStep = meta.bodySteps[meta.bodySteps.length - 1];
        const firstId = firstStep ? ctx.stepIds.get(firstStep) : undefined;
        const lastId = lastStep ? ctx.stepIds.get(lastStep) : undefined;
        if (firstId && lastId) {
          const decision = resolveDecision(meta.decision, meta.condition, (n) =>
            ctx.emittedNodes.has(n)
          );
          let label: string;
          if (decision?.value !== undefined) {
            label = `${String(decision.value)}, max ${meta.maxIterations}`;
          } else {
            const conditionName = meta.conditionName ?? nextId(ctx, 'cond');
            label = `if ${conditionName}, max ${meta.maxIterations}`;
            if (!meta.conditionName) {
              ctx.bindComments.push(
                `  %% bind conditions.${conditionName} on import`
              );
            }
          }
          emitEdge(ctx, lastId, firstId, label);
        }
        break;
      }
      case 'parallel': {
        if (step.meta?.kind !== 'parallel') {
          break;
        }
        const tails: string[] = [];
        for (const branchFn of step.meta.branchFns) {
          const branchSteps = materializeParallelBranch(branchFn);
          const branchFrontier = walkSteps(
            ctx,
            branchSteps,
            frontier,
            materializeParallelBranch,
            pendingLabel
          );
          for (const tail of branchFrontier) {
            if (!tails.includes(tail)) {
              tails.push(tail);
            }
          }
        }
        pendingLabel = undefined;
        if (tails.length > 0) {
          frontier = tails;
        }
        break;
      }
      case 'parallelMerge': {
        const resultKey =
          step.meta?.kind === 'parallelMerge' ? step.meta.resultKey : 'merged';
        const id = nextId(ctx, 'merge');
        emitStepNode(
          ctx,
          step,
          id,
          'round',
          `merge ${resultKey}`,
          frontier,
          pendingLabel,
          capture
        );
        ctx.bindComments.push(`  %% bind nodes.${id} to a function on import`);
        pendingLabel = undefined;
        frontier = [id];
        break;
      }
      default:
        break;
    }
  }

  return frontier;
}

export function renderFlowMermaid(args: {
  steps: readonly AxFlowStep[];
  nodePrograms: ReadonlyMap<string, AxProgrammable<any, any, any>>;
  materializeParallelBranch: (
    branchFn: (subContext: unknown) => unknown
  ) => readonly AxFlowStep[];
  options?: AxFlowMermaidRenderOptions;
}): string {
  const { steps, nodePrograms, materializeParallelBranch, options } = args;

  const ctx: RenderContext = {
    statements: [],
    bindComments: [],
    emittedNodes: new Set(),
    emittedEdges: new Set(),
    stepIds: new Map(),
    diamonds: new Map(),
    counters: {},
  };

  collectDiamonds(steps, nodePrograms, ctx.diamonds, new Set());

  const directives: string[] = [];
  for (const [name, program] of nodePrograms) {
    const signature =
      typeof program?.getSignature === 'function'
        ? program.getSignature().toString()
        : undefined;
    if (signature) {
      directives.push(`  %%ax ${name}: ${signature}`);
    }
  }

  walkSteps(ctx, steps, [], materializeParallelBranch);

  const lines = [`flowchart ${options?.direction ?? 'TD'}`];
  if (directives.length > 0) {
    lines.push(...directives);
  }
  if (ctx.statements.length > 0) {
    lines.push('', ...ctx.statements);
  }
  if (ctx.bindComments.length > 0) {
    lines.push('', ...ctx.bindComments);
  }
  return `${lines.join('\n')}\n`;
}

// ============================================================================
// PARSER + COMPILER: mermaid dialect -> runnable flow
// ============================================================================

import { AxSignature } from '../dsp/sig.js';
import { explicitDependenciesKey } from './dependencyAnalyzer.js';
import type { AxFlowStepMeta } from './steps.js';
import type { AxFlowOptions, AxFlowState } from './types.js';

export class AxFlowMermaidError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly context: string,
    public readonly suggestion?: string
  ) {
    super(
      suggestion
        ? `${message} (line ${line}: "${context}") — ${suggestion}`
        : `${message} (line ${line}: "${context}")`
    );
    this.name = 'AxFlowMermaidError';
  }
}

export type AxFlowMermaidNodeBinding =
  | string
  | AxSignature
  | { forward: (...args: any[]) => any }
  | ((state: AxFlowState) => AxFlowState | Promise<AxFlowState>);

export interface AxFlowMermaidBindings {
  /**
   * Node implementations. A signature (string or AxSignature) or any
   * AxProgrammable overrides/satisfies a node's `%%ax` directive; a plain
   * function becomes a map step (full state in, full state out).
   */
  nodes?: Record<string, AxFlowMermaidNodeBinding>;
  /** Predicates referenced by `if <name>` / `while <name>` edge labels. */
  conditions?: Record<string, (state: AxFlowState) => boolean>;
  options?: AxFlowOptions;
}

type MermaidShape = 'rect' | 'round' | 'diamond';

type MermaidAst = {
  direction: string;
  directives: Map<string, { signatureText: string; line: number }>;
  nodes: Map<string, { shape: MermaidShape; label?: string; line: number }>;
  edges: Array<{ from: string; to: string; label?: string; line: number }>;
  order: Map<string, number>;
};

const SUPPORTED_SUBSET =
  'supported: "flowchart TD|LR|BT|RL", "%%ax id: signature" directives, %% comments, node statements id / id[label] / id(label) / id([label]) / id{field}, edges "A --> B", "A -->|label| B", chains and "&" fan-in/out';

const UNSUPPORTED_LINE =
  /^(subgraph\b|end\b|style\b|classDef\b|class\b|linkStyle\b|click\b|direction\b)/;
const UNSUPPORTED_ARROW = /(-\.+->|={2,}>|(?<!-)---(?!-)|~~~|--[^>|-])/;

export function parseFlowMermaid(text: string): MermaidAst {
  const ast: MermaidAst = {
    direction: 'TD',
    directives: new Map(),
    nodes: new Map(),
    edges: [],
    order: new Map(),
  };
  let sawHeader = false;
  let orderCounter = 0;

  const registerNode = (
    id: string,
    shape: MermaidShape,
    label: string | undefined,
    lineNo: number
  ): void => {
    if (!ast.order.has(id)) {
      ast.order.set(id, orderCounter++);
    }
    const existing = ast.nodes.get(id);
    if (!existing) {
      ast.nodes.set(id, { shape, label, line: lineNo });
      return;
    }
    // First explicit shape/label wins; bare references never downgrade it.
    if (existing.shape === 'rect' && existing.label === undefined) {
      ast.nodes.set(id, {
        shape,
        label: label ?? existing.label,
        line: lineNo,
      });
    }
  };

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i] ?? '';
    const line = raw.trim();
    if (line === '') {
      continue;
    }

    const axDirective = /^%%ax\s+([A-Za-z_]\w*)\s*:\s*(.+)$/.exec(line);
    if (axDirective) {
      const id = axDirective[1] as string;
      const signatureText = (axDirective[2] as string).trim();
      if (ast.directives.has(id)) {
        throw new AxFlowMermaidError(
          `Duplicate %%ax directive for node "${id}"`,
          lineNo,
          line,
          'Each node may declare its signature once'
        );
      }
      ast.directives.set(id, { signatureText, line: lineNo });
      continue;
    }
    if (line.startsWith('%%')) {
      continue;
    }

    const header = /^(?:flowchart|graph)\s+(\w+)\s*$/.exec(line);
    if (header) {
      if (sawHeader) {
        throw new AxFlowMermaidError(
          'Multiple flowchart headers',
          lineNo,
          line,
          'Keep a single "flowchart TD" (or LR/BT/RL) header'
        );
      }
      sawHeader = true;
      ast.direction = header[1] as string;
      continue;
    }

    if (UNSUPPORTED_LINE.test(line)) {
      const keyword = line.split(/[\s({[]/)[0];
      throw new AxFlowMermaidError(
        `Unsupported mermaid construct "${keyword}"`,
        lineNo,
        line,
        SUPPORTED_SUBSET
      );
    }
    if (!sawHeader) {
      throw new AxFlowMermaidError(
        'Missing flowchart header',
        lineNo,
        line,
        'Start the document with "flowchart TD" (or LR/BT/RL)'
      );
    }
    if (UNSUPPORTED_ARROW.test(line)) {
      throw new AxFlowMermaidError(
        'Unsupported arrow syntax',
        lineNo,
        line,
        `Only "-->" and "-->|label|" edges are supported. ${SUPPORTED_SUBSET}`
      );
    }

    // Statement line: nodeGroup (arrow nodeGroup)*
    let rest = line;
    const fail = (message: string, suggestion?: string): never => {
      throw new AxFlowMermaidError(
        message,
        lineNo,
        line,
        suggestion ?? SUPPORTED_SUBSET
      );
    };
    const parseNodeRef = (): string => {
      const idMatch = /^([A-Za-z_]\w*)\s*/.exec(rest);
      if (!idMatch) {
        return fail('Expected a node id') as never;
      }
      const id = idMatch[1] as string;
      rest = rest.slice(idMatch[0].length);
      let shape: MermaidShape | undefined;
      let label: string | undefined;
      const shapes: Array<[RegExp, MermaidShape]> = [
        [/^\(\(([^)]*)\)\)\s*/, 'rect'],
        [/^\(\[([^\]]*)\]\)\s*/, 'round'],
        [/^\(([^)]*)\)\s*/, 'round'],
        [/^\[([^\]]*)\]\s*/, 'rect'],
        [/^\{([^}]*)\}\s*/, 'diamond'],
      ];
      for (const [pattern, shapeName] of shapes) {
        const match = pattern.exec(rest);
        if (match) {
          shape = shapeName;
          label = (match[1] as string).replace(/^"|"$/g, '');
          rest = rest.slice(match[0].length);
          break;
        }
      }
      registerNode(id, shape ?? 'rect', shape ? label : undefined, lineNo);
      return id;
    };
    const parseGroup = (): string[] => {
      const ids = [parseNodeRef()];
      while (rest.startsWith('&')) {
        rest = rest.slice(1).trimStart();
        ids.push(parseNodeRef());
      }
      return ids;
    };

    let fromGroup = parseGroup();
    while (rest.length > 0) {
      const arrow = /^-->(?:\|([^|]*)\|)?\s*/.exec(rest);
      if (!arrow) {
        fail(`Unexpected content "${rest}"`);
      }
      rest = rest.slice((arrow as RegExpExecArray)[0].length);
      const label = (arrow as RegExpExecArray)[1]?.trim();
      const toGroup = parseGroup();
      for (const from of fromGroup) {
        for (const to of toGroup) {
          ast.edges.push({ from, to, label, line: lineNo });
        }
      }
      fromGroup = toGroup;
    }
  }

  if (!sawHeader) {
    throw new AxFlowMermaidError(
      'Missing flowchart header',
      1,
      lines[0]?.trim() ?? '',
      'Start the document with "flowchart TD" (or LR/BT/RL)'
    );
  }
  if (ast.nodes.size === 0) {
    throw new AxFlowMermaidError(
      'No nodes found in the diagram',
      1,
      '',
      'Declare at least one node and one edge'
    );
  }
  return ast;
}

// --- compile ----------------------------------------------------------------

export type AxFlowMermaidCompileHost = {
  createFlow: (options?: AxFlowOptions) => any;
  patchLastStep: (
    flowInstance: unknown,
    patch: {
      meta?: (
        existing: AxFlowStepMeta | undefined
      ) => AxFlowStepMeta | undefined;
      reads?: readonly string[];
      writes?: readonly string[];
    }
  ) => void;
};

type GenNodeInfo = {
  id: string;
  program: AxSignature | { forward: (...args: any[]) => any };
  inputs: Array<{ name: string; isOptional: boolean }>;
  outputs: Map<string, { typeName: string; options?: string[] }>;
};

type EdgeInfo = { from: string; to: string; label?: string; line: number };

type BackEdgeAction =
  | {
      kind: 'feedback';
      predicate: (s: AxFlowState) => boolean;
      target: string;
      max: number;
      decision?: { nodeName: string; field: string; value: unknown };
    }
  | {
      kind: 'while';
      condition: (s: AxFlowState) => boolean;
      conditionName: string;
      target: string;
      max: number;
    };

function compileError(
  message: string,
  edgeOrLine: { line: number } | number,
  context: string,
  suggestion?: string
): never {
  const line = typeof edgeOrLine === 'number' ? edgeOrLine : edgeOrLine.line;
  throw new AxFlowMermaidError(message, line, context, suggestion);
}

export function compileFlowFromMermaid(
  text: string,
  bindings: AxFlowMermaidBindings | undefined,
  host: AxFlowMermaidCompileHost
): unknown {
  const ast = parseFlowMermaid(text);
  const conditions = bindings?.conditions ?? {};

  // -- resolve node implementations -----------------------------------------
  const genNodes = new Map<string, GenNodeInfo>();
  const fnNodes = new Map<string, (state: AxFlowState) => any>();
  const unresolved: string[] = [];

  for (const [id, node] of ast.nodes) {
    const binding = bindings?.nodes?.[id];
    const directive = ast.directives.get(id);
    if (binding !== undefined) {
      if (typeof binding === 'function') {
        fnNodes.set(id, binding as (state: AxFlowState) => any);
        continue;
      }
      let program: GenNodeInfo['program'];
      let signature: AxSignature;
      if (typeof binding === 'string') {
        signature = AxSignature.create(binding);
        program = signature;
      } else if (binding instanceof AxSignature) {
        signature = binding;
        program = binding;
      } else {
        program = binding;
        signature = (
          binding as unknown as { getSignature: () => AxSignature }
        ).getSignature();
      }
      genNodes.set(id, {
        id,
        program,
        inputs: signature.getInputFields().map((field) => ({
          name: field.name,
          isOptional: !!field.isOptional,
        })),
        outputs: new Map(
          signature.getOutputFields().map((field) => [
            field.name,
            {
              typeName: field.type?.name ?? 'string',
              options: field.type?.options,
            },
          ])
        ),
      });
      continue;
    }
    if (directive) {
      let signature: AxSignature;
      try {
        signature = AxSignature.create(directive.signatureText);
      } catch (error) {
        compileError(
          `Invalid signature for node "${id}": ${error instanceof Error ? error.message : String(error)}`,
          directive.line,
          directive.signatureText
        );
      }
      genNodes.set(id, {
        id,
        program: signature!,
        inputs: signature!.getInputFields().map((field) => ({
          name: field.name,
          isOptional: !!field.isOptional,
        })),
        outputs: new Map(
          signature!.getOutputFields().map((field) => [
            field.name,
            {
              typeName: field.type?.name ?? 'string',
              options: field.type?.options,
            },
          ])
        ),
      });
      continue;
    }
    unresolved.push(id);
  }
  if (unresolved.length > 0) {
    compileError(
      `No signature for node(s): ${unresolved.join(', ')}`,
      ast.nodes.get(unresolved[0] as string)?.line ?? 1,
      unresolved.join(', '),
      'Add a "%%ax <id>: <signature>" directive or supply bindings.nodes[<id>]'
    );
  }

  // -- classify edges + topological order -----------------------------------
  // DFS-based back-edge detection: an edge is a back-edge iff it points at a
  // node currently on the DFS stack (i.e. it closes a cycle). Reconvergence
  // to an already-finished node stays a forward edge, so diamonds written in
  // any line order classify correctly. DFS roots follow document order.
  const forwardEdges: EdgeInfo[] = [];
  const backEdges: EdgeInfo[] = [];
  {
    const adjacency = new Map<string, EdgeInfo[]>();
    for (const id of ast.nodes.keys()) {
      adjacency.set(id, []);
    }
    for (const edge of ast.edges) {
      adjacency.get(edge.from)?.push(edge);
    }
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    const visit = (id: string): void => {
      color.set(id, GRAY);
      for (const edge of adjacency.get(id) ?? []) {
        const targetColor = color.get(edge.to) ?? WHITE;
        if (targetColor === GRAY) {
          backEdges.push(edge);
        } else {
          forwardEdges.push(edge);
          if (targetColor === WHITE) {
            visit(edge.to);
          }
        }
      }
      color.set(id, BLACK);
    };
    for (const id of ast.nodes.keys()) {
      if ((color.get(id) ?? WHITE) === WHITE) {
        visit(id);
      }
    }
  }

  const successors = new Map<string, EdgeInfo[]>();
  const predecessors = new Map<string, EdgeInfo[]>();
  for (const id of ast.nodes.keys()) {
    successors.set(id, []);
    predecessors.set(id, []);
  }
  for (const edge of forwardEdges) {
    successors.get(edge.from)?.push(edge);
    predecessors.get(edge.to)?.push(edge);
  }

  const indegree = new Map<string, number>();
  for (const id of ast.nodes.keys()) {
    indegree.set(id, predecessors.get(id)?.length ?? 0);
  }
  const byDocOrder = (a: string, b: string) =>
    (ast.order.get(a) ?? 0) - (ast.order.get(b) ?? 0);
  const queue = [...ast.nodes.keys()]
    .filter((id) => indegree.get(id) === 0)
    .sort(byDocOrder);
  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    topoOrder.push(id);
    for (const edge of successors.get(id) ?? []) {
      const next = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, next);
      if (next === 0) {
        queue.push(edge.to);
        queue.sort(byDocOrder);
      }
    }
  }
  if (topoOrder.length < ast.nodes.size) {
    const cyclic = [...ast.nodes.keys()].filter(
      (id) => !topoOrder.includes(id)
    );
    compileError(
      `Cycle without a back-edge involving: ${cyclic.join(', ')}`,
      ast.nodes.get(cyclic[0] as string)?.line ?? 1,
      cyclic.join(' -> '),
      'Loops must be written as a back-edge: declare the loop target earlier in the document than the loop source'
    );
  }
  const topoIndex = new Map(topoOrder.map((id, index) => [id, index]));

  // -- decision fields --------------------------------------------------------
  const decisionFieldOf = (id: string, edge: EdgeInfo): string => {
    const info = genNodes.get(id);
    if (!info) {
      compileError(
        `Node "${id}" has labeled edges but is not a signature node`,
        edge,
        `${edge.from} -->|${edge.label}| ${edge.to}`,
        'Only signature nodes can decide branches'
      );
    }
    const diamond = ast.nodes.get(id);
    if (diamond?.shape === 'diamond' && diamond.label) {
      if (!info!.outputs.has(diamond.label)) {
        compileError(
          `Decision field "${diamond.label}" is not an output of node "${id}"`,
          diamond.line,
          `${id}{${diamond.label}}`,
          `Outputs of "${id}": ${[...info!.outputs.keys()].join(', ')}`
        );
      }
      return diamond.label;
    }
    const classFields = [...info!.outputs.entries()].filter(
      ([, meta]) => meta.typeName === 'class' || meta.typeName === 'boolean'
    );
    if (classFields.length === 1) {
      return (classFields[0] as [string, unknown])[0];
    }
    compileError(
      `Cannot infer the decision field for node "${id}"`,
      edge,
      `${edge.from} -->|${edge.label}| ${edge.to}`,
      `Declare the node as a diamond naming the field, e.g. ${id}{fieldName}`
    );
  };

  const coerceDecisionValue = (
    id: string,
    field: string,
    value: string,
    edge: EdgeInfo
  ): unknown => {
    const meta = genNodes.get(id)?.outputs.get(field);
    if (meta?.typeName === 'boolean') {
      if (value === 'true') return true;
      if (value === 'false') return false;
      compileError(
        `Edge label "${value}" is not valid for boolean field "${field}"`,
        edge,
        `${edge.from} -->|${edge.label}| ${edge.to}`,
        'Use true or false'
      );
    }
    if (meta?.options && !meta.options.includes(value)) {
      compileError(
        `Edge label "${value}" is not an option of "${id}.${field}"`,
        edge,
        `${edge.from} -->|${edge.label}| ${edge.to}`,
        `Valid options: ${meta.options.join(', ')}`
      );
    }
    return value;
  };

  // Labeled forward edges group into branch decisions.
  const labeledForward = new Map<
    string,
    Array<{ value: string; to: string; edge: EdgeInfo }>
  >();
  for (const edge of forwardEdges) {
    if (edge.label === undefined || edge.label === '') {
      continue;
    }
    if (/^(if|while)\s/.test(edge.label)) {
      compileError(
        `"${edge.label}" is only valid on back-edges`,
        edge,
        `${edge.from} -->|${edge.label}| ${edge.to}`,
        'Forward branching uses class option values as edge labels'
      );
    }
    const list = labeledForward.get(edge.from) ?? [];
    list.push({ value: edge.label, to: edge.to, edge });
    labeledForward.set(edge.from, list);
  }

  // -- back-edge actions -------------------------------------------------------
  const parseBackLabel = (
    edge: EdgeInfo
  ): {
    keyword?: 'if' | 'while';
    name?: string;
    value?: string;
    max?: number;
  } => {
    if (edge.label === undefined || edge.label === '') {
      compileError(
        'Back-edges need a label',
        edge,
        `${edge.from} --> ${edge.to}`,
        'Label the loop edge with a class option value, "if <condition>", or "while <condition>", optionally adding ", max N"'
      );
    }
    const parts = (edge.label as string).split(',').map((part) => part.trim());
    let max: number | undefined;
    const rest: string[] = [];
    for (const part of parts) {
      const maxMatch = /^max\s+(\d+)$/.exec(part);
      if (maxMatch) {
        max = Number(maxMatch[1]);
      } else if (part !== '') {
        rest.push(part);
      }
    }
    const head = rest.join(', ');
    const keyword = /^(if|while)\s+([A-Za-z_]\w*)$/.exec(head);
    if (keyword) {
      return {
        keyword: keyword[1] as 'if' | 'while',
        name: keyword[2] as string,
        max,
      };
    }
    return { value: head, max };
  };

  const feedbackBySource = new Map<string, BackEdgeAction[]>();
  const whileByTarget = new Map<
    string,
    BackEdgeAction & { kind: 'while'; source: string }
  >();
  for (const edge of backEdges) {
    const parsed = parseBackLabel(edge);
    if (parsed.keyword === 'while') {
      const condition = conditions[parsed.name as string];
      if (!condition) {
        compileError(
          `Missing condition binding "${parsed.name}"`,
          edge,
          `${edge.from} -->|${edge.label}| ${edge.to}`,
          `Pass bindings.conditions.${parsed.name}`
        );
      }
      if (whileByTarget.has(edge.to)) {
        compileError(
          `Node "${edge.to}" is the target of more than one while back-edge`,
          edge,
          `${edge.from} -->|${edge.label}| ${edge.to}`
        );
      }
      whileByTarget.set(edge.to, {
        kind: 'while',
        condition: condition as (s: AxFlowState) => boolean,
        conditionName: parsed.name as string,
        target: edge.to,
        source: edge.from,
        max: parsed.max ?? 100,
      });
      continue;
    }
    let predicate: (s: AxFlowState) => boolean;
    let decision:
      | { nodeName: string; field: string; value: unknown }
      | undefined;
    if (parsed.keyword === 'if') {
      const condition = conditions[parsed.name as string];
      if (!condition) {
        compileError(
          `Missing condition binding "${parsed.name}"`,
          edge,
          `${edge.from} -->|${edge.label}| ${edge.to}`,
          `Pass bindings.conditions.${parsed.name}`
        );
      }
      predicate = condition as (s: AxFlowState) => boolean;
    } else {
      const field = decisionFieldOf(edge.from, edge);
      const value = coerceDecisionValue(
        edge.from,
        field,
        parsed.value as string,
        edge
      );
      const source = edge.from;
      predicate = (state: AxFlowState) =>
        (state[`${source}Result`] as Record<string, unknown> | undefined)?.[
          field
        ] === value;
      decision = { nodeName: source, field, value };
    }
    const list = feedbackBySource.get(edge.from) ?? [];
    list.push({
      kind: 'feedback',
      predicate,
      target: edge.to,
      max: parsed.max ?? 10,
      decision,
    });
    feedbackBySource.set(edge.from, list);
  }

  // -- branch structure ----------------------------------------------------
  const reachableFrom = (start: string): Set<string> => {
    const seen = new Set<string>([start]);
    const stack = [start];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      for (const edge of successors.get(id) ?? []) {
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          stack.push(edge.to);
        }
      }
    }
    return seen;
  };

  type BranchPlan = {
    decision: string;
    field: string;
    join?: string;
    branches: Array<{ value: unknown; body: string[] }>;
  };
  const branchPlans = new Map<string, BranchPlan>();
  const branchOf = new Map<string, { decision: string; value: unknown }>();

  for (const [decisionId, edges] of labeledForward) {
    if (edges.length < 2) {
      continue; // single labeled forward edge is plain continuation
    }
    const field = decisionFieldOf(
      decisionId,
      (edges[0] as { edge: EdgeInfo }).edge
    );
    const reach = edges.map(({ to }) => reachableFrom(to));
    const common = [...(reach[0] as Set<string>)].filter((id) =>
      reach.every((set) => set.has(id))
    );
    const join = common.sort(
      (a, b) => (topoIndex.get(a) ?? 0) - (topoIndex.get(b) ?? 0)
    )[0];
    const branches: BranchPlan['branches'] = [];
    const seenBodies = new Map<string, unknown>();
    for (const { value, to, edge } of edges) {
      const coerced = coerceDecisionValue(decisionId, field, value, edge);
      const body = [...(reachableFrom(to) as Set<string>)]
        .filter((id) => id !== join)
        .filter((id) => join === undefined || !reachableFrom(join).has(id))
        .sort((a, b) => (topoIndex.get(a) ?? 0) - (topoIndex.get(b) ?? 0));
      for (const member of body) {
        const owner = seenBodies.get(member);
        if (owner !== undefined && owner !== coerced) {
          compileError(
            `Branches of "${decisionId}" share node "${member}" before reconverging`,
            edge,
            `${edge.from} -->|${edge.label}| ${edge.to}`,
            'Give each branch its own nodes, or converge before the shared node'
          );
        }
        seenBodies.set(member, coerced);
        branchOf.set(member, { decision: decisionId, value: coerced });
      }
      branches.push({ value: coerced, body });
    }
    branchPlans.set(decisionId, {
      decision: decisionId,
      field,
      join,
      branches,
    });
  }

  // -- wiring ----------------------------------------------------------------
  type Wire = { to: string; from?: string[]; raw?: boolean };
  const wiringByNode = new Map<string, Wire[]>();
  const allProducers = new Map<string, string[]>();
  for (const info of genNodes.values()) {
    for (const field of info.outputs.keys()) {
      const list = allProducers.get(field) ?? [];
      list.push(info.id);
      allProducers.set(field, list);
    }
  }

  for (const info of genNodes.values()) {
    const wires: Wire[] = [];
    for (const input of info.inputs) {
      // Reverse BFS by levels over forward edges; fn nodes pass through.
      let level = (predecessors.get(info.id) ?? []).map((edge) => edge.from);
      const visited = new Set<string>([info.id]);
      let producers: string[] = [];
      while (level.length > 0 && producers.length === 0) {
        const next: string[] = [];
        for (const id of level) {
          if (visited.has(id)) continue;
          visited.add(id);
          if (genNodes.get(id)?.outputs.has(input.name)) {
            producers.push(id);
          }
          for (const edge of predecessors.get(id) ?? []) {
            next.push(edge.from);
          }
        }
        if (producers.length === 0) {
          level = next;
        }
      }
      if (producers.length > 1) {
        const decisions = new Set(
          producers.map((p) => branchOf.get(p)?.decision ?? `~${p}`)
        );
        const values = new Set(producers.map((p) => branchOf.get(p)?.value));
        const sameDecision =
          decisions.size === 1 &&
          ![...decisions][0]?.startsWith('~') &&
          values.size === producers.length;
        if (!sameDecision) {
          compileError(
            `Input "${input.name}" of node "${info.id}" is produced by ${producers.join(' and ')} at the same distance`,
            ast.nodes.get(info.id)?.line ?? 1,
            info.id,
            'Rename one output or wire through an intermediate node'
          );
        }
        producers = producers.sort(
          (a, b) => (topoIndex.get(a) ?? 0) - (topoIndex.get(b) ?? 0)
        );
      }
      if (producers.length > 0) {
        wires.push({ to: input.name, from: producers });
        continue;
      }
      const anywhere = (allProducers.get(input.name) ?? []).filter(
        (id) => id !== info.id
      );
      if (anywhere.length > 0) {
        compileError(
          `Input "${input.name}" of node "${info.id}" is produced by "${anywhere.join('", "')}" which is not upstream`,
          ast.nodes.get(info.id)?.line ?? 1,
          info.id,
          `Add an edge ${anywhere[0]} --> ${info.id} or rename the field`
        );
      }
      wires.push({ to: input.name, raw: true });
    }
    wiringByNode.set(info.id, wires);
  }

  const makeMapping = (
    wires: Wire[]
  ): ((state: AxFlowState) => AxFlowState) => {
    const mapping = (state: AxFlowState): AxFlowState => {
      const out: Record<string, unknown> = {};
      for (const wire of wires) {
        if (wire.raw) {
          if (state[wire.to] !== undefined) {
            out[wire.to] = state[wire.to];
          }
          continue;
        }
        for (const producer of wire.from ?? []) {
          const value = (
            state[`${producer}Result`] as Record<string, unknown> | undefined
          )?.[wire.to];
          if (value !== undefined) {
            out[wire.to] = value;
            break;
          }
        }
      }
      return out as AxFlowState;
    };
    const deps = [
      ...new Set(
        wires.flatMap((wire) =>
          wire.raw
            ? [wire.to]
            : (wire.from ?? []).map((producer) => `${producer}Result`)
        )
      ),
    ];
    (mapping as any)[explicitDependenciesKey] = deps;
    return mapping;
  };

  // -- emission ----------------------------------------------------------------
  const flowInstance = host.createFlow(bindings?.options);
  for (const id of ast.nodes.keys()) {
    const info = genNodes.get(id);
    if (info) {
      flowInstance.node(id, info.program);
    }
  }

  const feedbackTargets = new Set<string>();
  for (const actions of feedbackBySource.values()) {
    for (const action of actions) {
      feedbackTargets.add(action.target);
    }
  }

  const emitted = new Set<string>();
  const skipInMain = new Set<string>();
  for (const plan of branchPlans.values()) {
    for (const branch of plan.branches) {
      for (const id of branch.body) {
        skipInMain.add(id);
      }
    }
  }

  let activeWhile:
    | (BackEdgeAction & { kind: 'while'; source: string })
    | undefined;

  const emitNode = (id: string): void => {
    if (emitted.has(id)) {
      return;
    }
    emitted.add(id);

    const startsWhile = whileByTarget.get(id);
    if (startsWhile) {
      if (activeWhile) {
        compileError(
          `Nested while loops are not supported ("${id}" inside "${activeWhile.target}")`,
          ast.nodes.get(id)?.line ?? 1,
          id
        );
      }
      activeWhile = startsWhile;
      flowInstance.while(startsWhile.condition, startsWhile.max);
    }
    if (feedbackTargets.has(id)) {
      flowInstance.label(id);
    }

    const info = genNodes.get(id);
    if (info) {
      flowInstance.execute(id, makeMapping(wiringByNode.get(id) ?? []));
    } else {
      const transform = fnNodes.get(id) as (state: AxFlowState) => any;
      flowInstance.map(transform);
      host.patchLastStep(flowInstance, {
        meta: () => ({ kind: 'map', name: id }),
      });
    }

    if (activeWhile && activeWhile.source === id) {
      const closingWhile = activeWhile;
      flowInstance.endWhile();
      host.patchLastStep(flowInstance, {
        meta: (existing) =>
          existing?.kind === 'while'
            ? { ...existing, conditionName: closingWhile.conditionName }
            : existing,
      });
      activeWhile = undefined;
    }

    for (const action of feedbackBySource.get(id) ?? []) {
      if (action.kind !== 'feedback') continue;
      flowInstance.feedback(action.predicate, action.target, action.max);
      host.patchLastStep(flowInstance, {
        meta: (existing) =>
          existing?.kind === 'feedback'
            ? { ...existing, decision: action.decision as any }
            : existing,
      });
    }

    const plan = branchPlans.get(id);
    if (plan) {
      const decisionId = plan.decision;
      const field = plan.field;
      const predicate = (state: AxFlowState) =>
        (state[`${decisionId}Result`] as Record<string, unknown> | undefined)?.[
          field
        ];
      flowInstance.branch(predicate);
      for (const branch of plan.branches) {
        flowInstance.when(branch.value);
        for (const member of branch.body) {
          emitNode(member);
        }
      }
      flowInstance.merge();
      host.patchLastStep(flowInstance, {
        meta: (existing) =>
          existing?.kind === 'branch'
            ? { ...existing, decision: { nodeName: decisionId, field } }
            : existing,
      });
    }
  };

  for (const id of topoOrder) {
    if (!skipInMain.has(id)) {
      emitNode(id);
    }
  }
  if (activeWhile) {
    compileError(
      `While loop starting at "${(activeWhile as { target: string }).target}" never closes`,
      ast.nodes.get((activeWhile as { target: string }).target)?.line ?? 1,
      (activeWhile as { target: string }).target,
      'The while back-edge source must be reachable after its target'
    );
  }

  // -- synthetic returns projection -----------------------------------------
  const terminals = topoOrder.filter(
    (id) => genNodes.has(id) && (successors.get(id) ?? []).length === 0
  );
  const projection = new Map<string, string[]>();
  for (const id of terminals) {
    for (const field of genNodes.get(id)?.outputs.keys() ?? []) {
      const producers = projection.get(field) ?? [];
      producers.push(id);
      projection.set(field, producers);
    }
  }
  for (const [field, producers] of projection) {
    if (producers.length < 2) continue;
    const decisions = new Set(
      producers.map((p) => branchOf.get(p)?.decision ?? `~${p}`)
    );
    const values = new Set(producers.map((p) => branchOf.get(p)?.value));
    const sameDecision =
      decisions.size === 1 &&
      ![...decisions][0]?.startsWith('~') &&
      values.size === producers.length;
    if (!sameDecision) {
      compileError(
        `Output field "${field}" is produced by multiple terminal nodes: ${producers.join(', ')}`,
        ast.nodes.get(producers[0] as string)?.line ?? 1,
        producers.join(', '),
        'Rename one output or converge the terminals into a final node'
      );
    }
  }
  if (projection.size > 0) {
    const entries = [...projection.entries()];
    flowInstance.returns((state: AxFlowState) => {
      const out: Record<string, unknown> = {};
      for (const [field, producers] of entries) {
        for (const producer of producers) {
          const value = (
            state[`${producer}Result`] as Record<string, unknown> | undefined
          )?.[field];
          if (value !== undefined) {
            out[field] = value;
            break;
          }
        }
      }
      return out;
    });
    host.patchLastStep(flowInstance, {
      meta: () => ({ kind: 'returns', synthetic: true }),
      // Declaring the projection's reads/writes lets signature inference see
      // the flat output fields instead of node-prefixed result names.
      reads: [
        ...new Set(
          entries.flatMap(([, producers]) =>
            producers.map((producer) => `${producer}Result`)
          )
        ),
      ],
      writes: entries.map(([field]) => field),
    });
  }

  return flowInstance;
}
