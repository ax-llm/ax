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
