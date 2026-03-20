import type { AxFieldValue, AxProgramUsage } from '../../dsp/types.js';

export const AX_AGENT_RECURSIVE_ARTIFACT_FORMAT_VERSION = 1;
export const AX_AGENT_RECURSIVE_INSTRUCTION_SCHEMA =
  'ax-agent-recursive-slots-v1';

export const AX_AGENT_RECURSIVE_TARGET_IDS = {
  shared: 'root.actor.shared',
  root: 'root.actor.root',
  recursive: 'root.actor.recursive',
  terminal: 'root.actor.terminal',
  responder: 'root.responder',
} as const;

export type AxAgentRecursiveTargetId =
  (typeof AX_AGENT_RECURSIVE_TARGET_IDS)[keyof typeof AX_AGENT_RECURSIVE_TARGET_IDS];

export type AxAgentRecursiveNodeRole = 'root' | 'recursive' | 'terminal';

export type AxAgentRecursiveUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type AxAgentRecursiveTurn = {
  turn: number;
  code: string;
  output: string;
  isError: boolean;
  thought?: string;
};

export type AxAgentRecursiveFunctionCall = {
  qualifiedName: string;
  name?: string;
  error?: string;
};

export type AxAgentRecursiveTraceNode = {
  nodeId: string;
  parentId?: string;
  depth: number;
  role: AxAgentRecursiveNodeRole;
  taskDigest?: string;
  contextDigest?: string;
  completionType?: 'final' | 'askClarification';
  turnCount: number;
  childCount: number;
  actorTurns: AxAgentRecursiveTurn[];
  functionCalls: AxAgentRecursiveFunctionCall[];
  toolErrors: string[];
  localUsage: AxAgentRecursiveUsage;
  cumulativeUsage: AxAgentRecursiveUsage;
  children: AxAgentRecursiveTraceNode[];
};

export type AxAgentRecursiveExpensiveNode = {
  nodeId: string;
  role: AxAgentRecursiveNodeRole;
  depth: number;
  taskDigest?: string;
  totalTokens: number;
};

export type AxAgentRecursiveStats = {
  nodeCount: number;
  leafCount: number;
  maxDepth: number;
  recursiveCallCount: number;
  batchedFanOutCount: number;
  clarificationCount: number;
  errorCount: number;
  directAnswerCount: number;
  delegatedAnswerCount: number;
  rootLocalUsage: AxAgentRecursiveUsage;
  rootCumulativeUsage: AxAgentRecursiveUsage;
  topExpensiveNodes: AxAgentRecursiveExpensiveNode[];
};

type AxAgentRecursiveFeedbackPrediction = {
  recursiveTrace?: AxAgentRecursiveTraceNode;
  recursiveStats?: AxAgentRecursiveStats;
  functionCalls?: readonly { qualifiedName?: string; error?: string }[];
  toolErrors?: readonly string[];
};

export const createZeroRecursiveUsage = (): AxAgentRecursiveUsage => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
});

export const normalizeRecursiveUsage = (
  usage: Partial<AxAgentRecursiveUsage> | undefined
): AxAgentRecursiveUsage => {
  const promptTokens = Math.max(0, Math.floor(usage?.promptTokens ?? 0));
  const completionTokens = Math.max(
    0,
    Math.floor(usage?.completionTokens ?? 0)
  );
  const totalTokensRaw = Math.max(0, Math.floor(usage?.totalTokens ?? 0));
  const totalTokens = Math.max(totalTokensRaw, promptTokens + completionTokens);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
};

export const addRecursiveUsage = (
  left: Partial<AxAgentRecursiveUsage> | undefined,
  right: Partial<AxAgentRecursiveUsage> | undefined
): AxAgentRecursiveUsage => {
  const normalizedLeft = normalizeRecursiveUsage(left);
  const normalizedRight = normalizeRecursiveUsage(right);

  return {
    promptTokens: normalizedLeft.promptTokens + normalizedRight.promptTokens,
    completionTokens:
      normalizedLeft.completionTokens + normalizedRight.completionTokens,
    totalTokens: normalizedLeft.totalTokens + normalizedRight.totalTokens,
  };
};

export const diffRecursiveUsage = (
  after: Partial<AxAgentRecursiveUsage> | undefined,
  before: Partial<AxAgentRecursiveUsage> | undefined
): AxAgentRecursiveUsage => {
  const normalizedAfter = normalizeRecursiveUsage(after);
  const normalizedBefore = normalizeRecursiveUsage(before);

  return normalizeRecursiveUsage({
    promptTokens: Math.max(
      0,
      normalizedAfter.promptTokens - normalizedBefore.promptTokens
    ),
    completionTokens: Math.max(
      0,
      normalizedAfter.completionTokens - normalizedBefore.completionTokens
    ),
    totalTokens: Math.max(
      0,
      normalizedAfter.totalTokens - normalizedBefore.totalTokens
    ),
  });
};

export const usageFromProgramUsages = (
  usages: readonly AxProgramUsage[] | undefined
): AxAgentRecursiveUsage => {
  return (usages ?? []).reduce<AxAgentRecursiveUsage>(
    (acc, usage) =>
      addRecursiveUsage(acc, {
        promptTokens: usage.tokens?.promptTokens ?? 0,
        completionTokens: usage.tokens?.completionTokens ?? 0,
        totalTokens: usage.tokens?.totalTokens ?? 0,
      }),
    createZeroRecursiveUsage()
  );
};

export const buildRecursiveValueDigest = (
  value: unknown,
  maxChars = 240
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  let rendered: string;
  if (typeof value === 'string') {
    rendered = value;
  } else {
    try {
      rendered = JSON.stringify(value);
    } catch {
      rendered = String(value);
    }
  }

  const compact = rendered.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return undefined;
  }

  if (compact.length <= maxChars) {
    return compact;
  }

  return `${compact.slice(0, Math.max(0, maxChars - 3))}...`;
};

const stableObjectEntries = (value: Record<string, unknown>) =>
  Object.keys(value)
    .sort()
    .map((key) => [key, value[key]] as const);

const renderReflectiveValue = (value: unknown, maxChars = 400): string => {
  const toRenderable = (inner: unknown): unknown => {
    if (inner === undefined || inner === null) {
      return inner;
    }
    if (
      typeof inner === 'string' ||
      typeof inner === 'number' ||
      typeof inner === 'boolean'
    ) {
      return inner;
    }
    if (Array.isArray(inner)) {
      return inner.map((item) => toRenderable(item));
    }
    if (typeof inner === 'object') {
      return Object.fromEntries(
        stableObjectEntries(inner as Record<string, unknown>).map(
          ([key, item]) => [key, toRenderable(item)]
        )
      );
    }
    return String(inner);
  };

  if (typeof value === 'string') {
    return value.length <= maxChars
      ? value
      : `${value.slice(0, Math.max(0, maxChars - 3))}...`;
  }

  try {
    const rendered = JSON.stringify(toRenderable(value), null, 2);
    return rendered.length <= maxChars
      ? rendered
      : `${rendered.slice(0, Math.max(0, maxChars - 3))}...`;
  } catch {
    const fallback = String(value);
    return fallback.length <= maxChars
      ? fallback
      : `${fallback.slice(0, Math.max(0, maxChars - 3))}...`;
  }
};

export const projectRecursiveTraceForEval = (
  node: Readonly<AxAgentRecursiveTraceNode>,
  options?: Readonly<{
    maxCodeChars?: number;
    maxOutputChars?: number;
    maxTaskChars?: number;
    maxContextChars?: number;
    maxToolErrors?: number;
    maxFunctionCalls?: number;
    maxChildren?: number;
  }>
): AxAgentRecursiveTraceNode => {
  const maxCodeChars = options?.maxCodeChars ?? 220;
  const maxOutputChars = options?.maxOutputChars ?? 220;
  const maxTaskChars = options?.maxTaskChars ?? 220;
  const maxContextChars = options?.maxContextChars ?? 220;
  const maxToolErrors = options?.maxToolErrors ?? 12;
  const maxFunctionCalls = options?.maxFunctionCalls ?? 12;
  const maxChildren = options?.maxChildren ?? Number.POSITIVE_INFINITY;

  const children = node.children
    .slice(0, maxChildren)
    .map((child) => projectRecursiveTraceForEval(child, options));
  const localUsage = normalizeRecursiveUsage(node.localUsage);
  const cumulativeUsage = children.reduce(
    (acc, child) => addRecursiveUsage(acc, child.cumulativeUsage),
    localUsage
  );

  return {
    nodeId: node.nodeId,
    parentId: node.parentId,
    depth: node.depth,
    role: node.role,
    taskDigest: buildRecursiveValueDigest(node.taskDigest, maxTaskChars),
    contextDigest: buildRecursiveValueDigest(
      node.contextDigest,
      maxContextChars
    ),
    completionType: node.completionType,
    turnCount: node.turnCount,
    childCount: children.length,
    actorTurns: node.actorTurns.map((turn) => ({
      turn: turn.turn,
      code: buildRecursiveValueDigest(turn.code, maxCodeChars) ?? '',
      output: buildRecursiveValueDigest(turn.output, maxOutputChars) ?? '',
      isError: turn.isError,
      thought: buildRecursiveValueDigest(turn.thought, maxOutputChars),
    })),
    functionCalls: node.functionCalls
      .slice(0, maxFunctionCalls)
      .map((call) => ({
        qualifiedName: call.qualifiedName,
        name: call.name,
        error: buildRecursiveValueDigest(call.error, maxOutputChars),
      })),
    toolErrors: node.toolErrors
      .slice(0, maxToolErrors)
      .map((error) => buildRecursiveValueDigest(error, maxOutputChars) ?? ''),
    localUsage,
    cumulativeUsage,
    children,
  };
};

export const deriveRecursiveStats = (
  root: Readonly<AxAgentRecursiveTraceNode>
): AxAgentRecursiveStats => {
  let nodeCount = 0;
  let leafCount = 0;
  let maxDepth = 0;
  let recursiveCallCount = 0;
  let batchedFanOutCount = 0;
  let clarificationCount = 0;
  let errorCount = 0;
  let directAnswerCount = 0;
  let delegatedAnswerCount = 0;
  const expensiveNodes: AxAgentRecursiveExpensiveNode[] = [];

  const visit = (node: Readonly<AxAgentRecursiveTraceNode>) => {
    nodeCount++;
    maxDepth = Math.max(maxDepth, node.depth);

    if (node.depth > 0) {
      recursiveCallCount++;
    }
    if (node.children.length === 0) {
      leafCount++;
    }
    if (node.children.length > 1) {
      batchedFanOutCount++;
    }
    if (node.completionType === 'askClarification') {
      clarificationCount++;
    }

    const hasErrors =
      node.toolErrors.length > 0 ||
      node.functionCalls.some((call) => Boolean(call.error)) ||
      node.actorTurns.some((turn) => turn.isError);
    if (hasErrors) {
      errorCount++;
    }

    if (node.completionType === 'final') {
      if (node.children.length > 0) {
        delegatedAnswerCount++;
      } else {
        directAnswerCount++;
      }
    }

    expensiveNodes.push({
      nodeId: node.nodeId,
      role: node.role,
      depth: node.depth,
      taskDigest: node.taskDigest,
      totalTokens: node.cumulativeUsage.totalTokens,
    });

    for (const child of node.children) {
      visit(child);
    }
  };

  visit(root);

  return {
    nodeCount,
    leafCount,
    maxDepth,
    recursiveCallCount,
    batchedFanOutCount,
    clarificationCount,
    errorCount,
    directAnswerCount,
    delegatedAnswerCount,
    rootLocalUsage: normalizeRecursiveUsage(root.localUsage),
    rootCumulativeUsage: normalizeRecursiveUsage(root.cumulativeUsage),
    topExpensiveNodes: expensiveNodes
      .sort((left, right) => right.totalTokens - left.totalTokens)
      .slice(0, 5),
  };
};

export const renderRecursiveSummary = (
  root: Readonly<AxAgentRecursiveTraceNode>,
  stats: Readonly<AxAgentRecursiveStats>
): string => {
  const lines = [
    `Trace nodes=${stats.nodeCount}, leaves=${stats.leafCount}, maxDepth=${stats.maxDepth}, recursiveCalls=${stats.recursiveCallCount}, batchedFanOuts=${stats.batchedFanOutCount}.`,
    `Final answers direct=${stats.directAnswerCount}, delegated=${stats.delegatedAnswerCount}, clarifications=${stats.clarificationCount}, errorNodes=${stats.errorCount}.`,
    `Root role=${root.role}, root local tokens=${stats.rootLocalUsage.totalTokens}, root cumulative tokens=${stats.rootCumulativeUsage.totalTokens}.`,
  ];

  if (stats.topExpensiveNodes.length > 0) {
    const expensive = stats.topExpensiveNodes
      .map((node) => {
        const task =
          node.taskDigest && node.taskDigest.length > 0
            ? ` (${node.taskDigest})`
            : '';
        return `${node.nodeId}:${node.totalTokens}${task}`;
      })
      .join('; ');
    lines.push(`Most expensive nodes: ${expensive}.`);
  }

  return lines.join('\n');
};

const collectSiblingDigestOverlaps = (
  node: Readonly<AxAgentRecursiveTraceNode>,
  overlaps: string[]
) => {
  const seen = new Map<string, number>();
  for (const child of node.children) {
    const digest = child.taskDigest?.trim();
    if (!digest) {
      continue;
    }
    seen.set(digest, (seen.get(digest) ?? 0) + 1);
  }
  for (const [digest, count] of seen) {
    if (count > 1) {
      overlaps.push(digest);
    }
  }
  for (const child of node.children) {
    collectSiblingDigestOverlaps(child, overlaps);
  }
};

const flattenNodes = (
  root: Readonly<AxAgentRecursiveTraceNode>
): AxAgentRecursiveTraceNode[] => {
  const out: AxAgentRecursiveTraceNode[] = [];
  const visit = (node: Readonly<AxAgentRecursiveTraceNode>) => {
    out.push(node as AxAgentRecursiveTraceNode);
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return out;
};

export const buildRecursiveFeedback = (
  args: Readonly<{
    componentId?: string;
    prediction: AxAgentRecursiveFeedbackPrediction;
    example?: AxFieldValue;
  }>
): string[] | undefined => {
  const trace = args.prediction.recursiveTrace;
  const stats = args.prediction.recursiveStats;

  if (!trace || !stats) {
    return undefined;
  }

  const notes: string[] = [];
  const overlappingDigests: string[] = [];
  collectSiblingDigestOverlaps(trace, overlappingDigests);
  const nodes = flattenNodes(trace);
  const recursiveNodes = nodes.filter((node) => node.role === 'recursive');
  const terminalNodes = nodes.filter((node) => node.role === 'terminal');
  const rootDelegationRatio =
    stats.rootLocalUsage.totalTokens > 0
      ? stats.rootCumulativeUsage.totalTokens / stats.rootLocalUsage.totalTokens
      : stats.rootCumulativeUsage.totalTokens > 0
        ? Number.POSITIVE_INFINITY
        : 1;

  switch (args.componentId) {
    case AX_AGENT_RECURSIVE_TARGET_IDS.root: {
      if (trace.childCount >= 4) {
        notes.push(
          `Root decomposition fanned out into ${trace.childCount} subtasks. Delegate fewer, higher-leverage branches.`
        );
      }
      if (
        trace.childCount > 0 &&
        stats.rootCumulativeUsage.totalTokens >= 8_000 &&
        rootDelegationRatio >= 3
      ) {
        notes.push(
          `Root decomposition consumed ${stats.rootCumulativeUsage.totalTokens} total tokens versus ${stats.rootLocalUsage.totalTokens} local tokens. Prefer solving directly when a shallow answer is viable.`
        );
      }
      if (overlappingDigests.length > 0) {
        notes.push(
          `Sibling subtasks overlap in scope (${[...new Set(overlappingDigests)].slice(0, 2).join('; ')}). Make delegated tasks more distinct.`
        );
      }
      break;
    }
    case AX_AGENT_RECURSIVE_TARGET_IDS.recursive: {
      const chainedDelegations = recursiveNodes.filter(
        (node) =>
          node.childCount === 1 && node.cumulativeUsage.totalTokens >= 2_000
      );
      if (chainedDelegations.length > 0) {
        notes.push(
          `Mid-tree branches repeatedly delegated one child at a time (${chainedDelegations.length} such nodes). Collapse serial delegation when the current branch can finish locally.`
        );
      }
      const expensiveRecursive = recursiveNodes
        .filter((node) => node.cumulativeUsage.totalTokens >= 3_000)
        .sort(
          (left, right) =>
            right.cumulativeUsage.totalTokens - left.cumulativeUsage.totalTokens
        );
      if (expensiveRecursive.length > 0) {
        notes.push(
          `Recursive branches are expensive (${expensiveRecursive[0]!.cumulativeUsage.totalTokens} tokens on ${expensiveRecursive[0]!.nodeId}). Narrow context and avoid redundant child work.`
        );
      }
      break;
    }
    case AX_AGENT_RECURSIVE_TARGET_IDS.terminal: {
      const terminalErrors = terminalNodes.filter(
        (node) =>
          node.toolErrors.length > 0 ||
          node.functionCalls.some((call) => Boolean(call.error)) ||
          node.actorTurns.some((turn) => turn.isError)
      );
      if (terminalErrors.length > 0) {
        notes.push(
          `Terminal-depth nodes still hit avoidable errors (${terminalErrors.length} nodes). Terminal instructions should prefer direct, minimal answers from already available context.`
        );
      }
      const verboseTerminal = terminalNodes.filter(
        (node) => node.localUsage.totalTokens >= 2_000 || node.turnCount >= 3
      );
      if (verboseTerminal.length > 0) {
        notes.push(
          `Terminal-depth nodes spent too much effort before answering (${verboseTerminal.length} nodes over budget). Encourage concise direct answers at max depth.`
        );
      }
      break;
    }
    case AX_AGENT_RECURSIVE_TARGET_IDS.shared: {
      if (stats.errorCount > 0) {
        notes.push(
          `The trace contains ${stats.errorCount} error-producing nodes. Reinforce careful tool use, argument validation, and earlier stopping when the answer is already sufficient.`
        );
      }
      if (
        stats.rootCumulativeUsage.totalTokens >= 10_000 &&
        stats.recursiveCallCount >= 3
      ) {
        notes.push(
          `Tree-wide behavior is expensive (${stats.rootCumulativeUsage.totalTokens} cumulative tokens across ${stats.recursiveCallCount} recursive calls). Add stronger cost-awareness before delegating.`
        );
      }
      if (
        stats.delegatedAnswerCount > 0 &&
        stats.directAnswerCount === 0 &&
        stats.recursiveCallCount >= 2
      ) {
        notes.push(
          'The agent delegated every successful branch. Add a general rule to answer directly whenever the task can be completed without further recursion.'
        );
      }
      break;
    }
    default: {
      if (stats.errorCount > 0) {
        notes.push(
          `The recursive trace contains ${stats.errorCount} error-producing nodes.`
        );
      }
      break;
    }
  }

  return notes.length > 0 ? notes : undefined;
};

export const renderReflectiveDatasetValue = renderReflectiveValue;

export const createRecursiveSlotSeedInstructions = (
  sharedInstruction?: string
): Record<AxAgentRecursiveTargetId, string> => ({
  [AX_AGENT_RECURSIVE_TARGET_IDS.shared]: sharedInstruction?.trim() ?? '',
  [AX_AGENT_RECURSIVE_TARGET_IDS.root]:
    'At the root, decide whether to solve directly or decompose. Delegate only when it clearly improves accuracy or reduces risk.',
  [AX_AGENT_RECURSIVE_TARGET_IDS.recursive]:
    'Within recursive branches, avoid redundant delegation. Narrow context, keep sibling tasks distinct, and finish locally when further fan-out is unnecessary.',
  [AX_AGENT_RECURSIVE_TARGET_IDS.terminal]:
    'At terminal depth, answer directly from the available context. Do not spend extra turns or imitate deeper delegation.',
  [AX_AGENT_RECURSIVE_TARGET_IDS.responder]: '',
});

export const buildRecursiveActorInstruction = (
  role: AxAgentRecursiveNodeRole,
  slots: Readonly<Record<string, string | undefined>>
): string | undefined => {
  const pieces = [
    slots[AX_AGENT_RECURSIVE_TARGET_IDS.shared]?.trim(),
    role === 'root'
      ? slots[AX_AGENT_RECURSIVE_TARGET_IDS.root]?.trim()
      : role === 'recursive'
        ? slots[AX_AGENT_RECURSIVE_TARGET_IDS.recursive]?.trim()
        : slots[AX_AGENT_RECURSIVE_TARGET_IDS.terminal]?.trim(),
  ].filter((piece): piece is string => Boolean(piece));

  if (pieces.length === 0) {
    return undefined;
  }

  return pieces.join('\n\n');
};
