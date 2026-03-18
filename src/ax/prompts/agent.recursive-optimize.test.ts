import { describe, expect, it } from 'vitest';

import {
  AX_AGENT_RECURSIVE_TARGET_IDS,
  buildRecursiveFeedback,
  createRecursiveSlotSeedInstructions,
  createZeroRecursiveUsage,
  deriveRecursiveStats,
  projectRecursiveTraceForEval,
  renderRecursiveSummary,
  renderReflectiveDatasetValue,
  type AxAgentRecursiveTraceNode,
} from './agentRecursiveOptimize.js';

const usage = (totalTokens: number) => ({
  promptTokens: Math.floor(totalTokens * 0.6),
  completionTokens: Math.ceil(totalTokens * 0.4),
  totalTokens,
});

const createNode = (
  overrides: Partial<AxAgentRecursiveTraceNode>
): AxAgentRecursiveTraceNode => ({
  nodeId: overrides.nodeId ?? 'node',
  parentId: overrides.parentId,
  depth: overrides.depth ?? 0,
  role: overrides.role ?? 'root',
  taskDigest: overrides.taskDigest ?? 'task',
  contextDigest: overrides.contextDigest,
  completionType: overrides.completionType ?? 'final',
  turnCount: overrides.turnCount ?? 1,
  childCount: overrides.childCount ?? overrides.children?.length ?? 0,
  actorTurns: overrides.actorTurns ?? [],
  functionCalls: overrides.functionCalls ?? [],
  toolErrors: overrides.toolErrors ?? [],
  localUsage: overrides.localUsage ?? createZeroRecursiveUsage(),
  cumulativeUsage:
    overrides.cumulativeUsage ??
    overrides.localUsage ??
    createZeroRecursiveUsage(),
  children: overrides.children ?? [],
});

describe('agentRecursiveOptimize helpers', () => {
  it('projects a recursive trace with cumulative token totals', () => {
    const raw = createNode({
      nodeId: 'root',
      role: 'root',
      localUsage: usage(200),
      actorTurns: [
        {
          turn: 1,
          code: 'const result = "abcdefghijklmnopqrstuvwxyz".repeat(50); console.log(result);',
          output: 'y'.repeat(500),
          isError: false,
        },
      ],
      children: [
        createNode({
          nodeId: 'child',
          parentId: 'root',
          depth: 1,
          role: 'recursive',
          localUsage: usage(300),
        }),
      ],
    });

    const projected = projectRecursiveTraceForEval(raw, {
      maxCodeChars: 32,
      maxOutputChars: 32,
    });

    expect(projected.cumulativeUsage.totalTokens).toBe(500);
    expect(projected.childCount).toBe(1);
    expect(projected.actorTurns[0]?.code.endsWith('...')).toBe(true);
    expect(projected.actorTurns[0]?.output.endsWith('...')).toBe(true);
  });

  it('derives recursive stats for over-decomposed traces', () => {
    const projected = projectRecursiveTraceForEval(
      createNode({
        nodeId: 'root',
        role: 'root',
        localUsage: usage(900),
        children: [
          createNode({
            nodeId: 'child-a',
            parentId: 'root',
            depth: 1,
            role: 'recursive',
            taskDigest: 'same branch',
            localUsage: usage(2_400),
            children: [
              createNode({
                nodeId: 'leaf-a',
                parentId: 'child-a',
                depth: 2,
                role: 'terminal',
                taskDigest: 'same branch',
                localUsage: usage(900),
                actorTurns: [
                  {
                    turn: 1,
                    code: 'throw new Error("oops")',
                    output: 'oops',
                    isError: true,
                  },
                ],
                toolErrors: ['tool failed'],
              }),
            ],
          }),
          createNode({
            nodeId: 'child-b',
            parentId: 'root',
            depth: 1,
            role: 'recursive',
            taskDigest: 'same branch',
            localUsage: usage(2_100),
          }),
          createNode({
            nodeId: 'child-c',
            parentId: 'root',
            depth: 1,
            role: 'recursive',
            taskDigest: 'third branch',
            localUsage: usage(1_700),
          }),
          createNode({
            nodeId: 'child-d',
            parentId: 'root',
            depth: 1,
            role: 'recursive',
            taskDigest: 'fourth branch',
            localUsage: usage(1_600),
          }),
        ],
      })
    );

    const stats = deriveRecursiveStats(projected);
    const summary = renderRecursiveSummary(projected, stats);

    expect(stats.nodeCount).toBe(6);
    expect(stats.maxDepth).toBe(2);
    expect(stats.recursiveCallCount).toBe(5);
    expect(stats.batchedFanOutCount).toBe(1);
    expect(stats.errorCount).toBe(1);
    expect(stats.topExpensiveNodes[0]?.nodeId).toBe('root');
    expect(summary).toContain('root cumulative tokens=');
  });

  it('builds root-level feedback for expensive over-decomposition', () => {
    const projected = projectRecursiveTraceForEval(
      createNode({
        nodeId: 'root',
        role: 'root',
        localUsage: usage(1_000),
        children: [
          createNode({
            nodeId: 'child-a',
            parentId: 'root',
            depth: 1,
            role: 'recursive',
            taskDigest: 'duplicate branch',
            localUsage: usage(2_500),
          }),
          createNode({
            nodeId: 'child-b',
            parentId: 'root',
            depth: 1,
            role: 'recursive',
            taskDigest: 'duplicate branch',
            localUsage: usage(2_300),
          }),
          createNode({
            nodeId: 'child-c',
            parentId: 'root',
            depth: 1,
            role: 'recursive',
            taskDigest: 'third branch',
            localUsage: usage(2_200),
          }),
          createNode({
            nodeId: 'child-d',
            parentId: 'root',
            depth: 1,
            role: 'recursive',
            taskDigest: 'fourth branch',
            localUsage: usage(2_100),
          }),
        ],
      })
    );

    const feedback = buildRecursiveFeedback({
      componentId: AX_AGENT_RECURSIVE_TARGET_IDS.root,
      prediction: {
        recursiveTrace: projected,
        recursiveStats: deriveRecursiveStats(projected),
      },
    });

    expect(feedback?.join('\n')).toContain('fanned out into 4 subtasks');
    expect(feedback?.join('\n')).toContain('overlap in scope');
    expect(feedback?.join('\n')).toContain('Prefer solving directly');
  });

  it('builds terminal feedback for noisy max-depth behavior', () => {
    const projected = projectRecursiveTraceForEval(
      createNode({
        nodeId: 'root',
        role: 'root',
        localUsage: usage(400),
        children: [
          createNode({
            nodeId: 'leaf',
            parentId: 'root',
            depth: 1,
            role: 'terminal',
            localUsage: usage(2_400),
            turnCount: 4,
            actorTurns: [
              {
                turn: 1,
                code: 'throw new Error("boom")',
                output: 'boom',
                isError: true,
              },
            ],
            toolErrors: ['boom'],
          }),
        ],
      })
    );

    const feedback = buildRecursiveFeedback({
      componentId: AX_AGENT_RECURSIVE_TARGET_IDS.terminal,
      prediction: {
        recursiveTrace: projected,
        recursiveStats: deriveRecursiveStats(projected),
      },
    });

    expect(feedback?.join('\n')).toContain('Terminal-depth nodes still hit');
    expect(feedback?.join('\n')).toContain('spent too much effort');
  });

  it('supports a no-recursion success shape without root over-decomposition feedback', () => {
    const projected = projectRecursiveTraceForEval(
      createNode({
        nodeId: 'root',
        role: 'root',
        localUsage: usage(450),
        turnCount: 1,
        children: [],
      })
    );

    const feedback = buildRecursiveFeedback({
      componentId: AX_AGENT_RECURSIVE_TARGET_IDS.root,
      prediction: {
        recursiveTrace: projected,
        recursiveStats: deriveRecursiveStats(projected),
      },
    });

    expect(feedback).toBeUndefined();
  });

  it('renders nested reflective dataset values as JSON instead of object tags', () => {
    const rendered = renderReflectiveDatasetValue({
      trace: {
        root: { children: [{ taskDigest: 'branch-a' }] },
      },
    });

    expect(rendered).toContain('"branch-a"');
    expect(rendered).not.toContain('[object Object]');
  });

  it('creates recursive slot seeds with responder left empty', () => {
    const seeds = createRecursiveSlotSeedInstructions('shared seed');

    expect(seeds[AX_AGENT_RECURSIVE_TARGET_IDS.shared]).toBe('shared seed');
    expect(seeds[AX_AGENT_RECURSIVE_TARGET_IDS.responder]).toBe('');
    expect(seeds[AX_AGENT_RECURSIVE_TARGET_IDS.root]).toContain(
      'solve directly or decompose'
    );
  });
});
