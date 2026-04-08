import { type AxSignature, f } from '../../dsp/sig.js';
import type { AxFieldValue, AxProgramForwardOptions } from '../../dsp/types.js';
import type {
  AxAgentEvalDataset,
  AxAgentEvalFunctionCall,
  AxAgentEvalPrediction,
  AxAgentEvalTask,
  AxAgentJudgeEvalInput,
  AxAgentJudgeEvalOutput,
  AxAgentJudgeInput,
  AxAgentJudgeOptions,
  AxAgentJudgeOutput,
  AxAgentOptimizeTarget,
  AxNormalizedAgentEvalDataset,
} from './AxAgent.js';
import { AX_AGENT_RECURSIVE_TARGET_IDS } from './agentRecursiveOptimize.js';

export const DEFAULT_AGENT_OPTIMIZE_MAX_METRIC_CALLS = 100;

export const _AX_AGENT_OPTIMIZE_JUDGE_SIGNATURE: AxSignature<
  AxAgentJudgeInput,
  AxAgentJudgeOutput
> = f()
  .input('taskInput', f.json('The structured task input passed to the agent'))
  .input('criteria', f.string('Task-specific success criteria'))
  .input('expectedOutput', f.json('Optional expected final output').optional())
  .input(
    'expectedActions',
    f
      .string('Optional function names that should appear in the run')
      .array()
      .optional()
  )
  .input(
    'forbiddenActions',
    f
      .string('Optional function names that should not appear in the run')
      .array()
      .optional()
  )
  .input('metadata', f.json('Optional task metadata').optional())
  .output('completionType', f.string('How the agent completed the run'))
  .output(
    'clarification',
    f
      .json(
        'Structured clarification payload when the agent asked for more information'
      )
      .optional()
  )
  .output(
    'finalOutput',
    f
      .json(
        'The final structured output returned by the agent when it completed normally'
      )
      .optional()
  )
  .output(
    'guidanceLog',
    f
      .string(
        'Chronological guidance log shown to the actor loop when runtime guidance was issued'
      )
      .optional()
  )
  .output(
    'actionLog',
    f.string('Chronological action log produced by the actor loop')
  )
  .output(
    'functionCalls',
    f
      .json(
        'Ordered function call records with names, arguments, results, and errors'
      )
      .optional()
  )
  .output(
    'toolErrors',
    f.string('Function-call errors observed during the run').array().optional()
  )
  .output('turnCount', f.number('Number of actor turns executed'))
  .output('usage', f.json('Optional usage summary for the run').optional())
  .output(
    'recursiveTrace',
    f
      .json(
        'Optional structured recursive trace projection for advanced recursive llmQuery runs'
      )
      .optional()
  )
  .output(
    'recursiveStats',
    f
      .json(
        'Optional deterministic recursive trace statistics for advanced recursive llmQuery runs'
      )
      .optional()
  )
  .build();

export const AX_AGENT_OPTIMIZE_JUDGE_EVAL_SIGNATURE: AxSignature<
  AxAgentJudgeEvalInput,
  AxAgentJudgeEvalOutput
> = f()
  .input('taskInput', f.json('The structured task input passed to the agent'))
  .input('criteria', f.string('Task-specific success criteria'))
  .input('expectedOutput', f.json('Optional expected final output').optional())
  .input(
    'expectedActions',
    f
      .string('Optional function names that should appear in the run')
      .array()
      .optional()
  )
  .input(
    'forbiddenActions',
    f
      .string('Optional function names that should not appear in the run')
      .array()
      .optional()
  )
  .input('metadata', f.json('Optional task metadata').optional())
  .input('completionType', f.string('How the agent completed the run'))
  .input(
    'clarification',
    f
      .json(
        'Structured clarification payload when the agent asked for more information'
      )
      .optional()
  )
  .input(
    'finalOutput',
    f
      .json(
        'The final structured output returned by the agent when it completed normally'
      )
      .optional()
  )
  .input(
    'guidanceLog',
    f
      .string(
        'Chronological guidance log shown to the actor loop when runtime guidance was issued'
      )
      .optional()
  )
  .input(
    'actionLog',
    f.string('Chronological action log produced by the actor loop')
  )
  .input(
    'functionCalls',
    f
      .json(
        'Ordered function call records with names, arguments, results, and errors'
      )
      .optional()
  )
  .input(
    'toolErrors',
    f.string('Function-call errors observed during the run').array().optional()
  )
  .input('turnCount', f.number('Number of actor turns executed'))
  .input('usage', f.json('Optional usage summary for the run').optional())
  .input(
    'recursiveTrace',
    f
      .json(
        'Optional structured recursive trace projection for advanced recursive llmQuery runs'
      )
      .optional()
  )
  .input(
    'recursiveStats',
    f
      .json(
        'Optional deterministic recursive trace statistics for advanced recursive llmQuery runs'
      )
      .optional()
  )
  .output('reasoning', f.string('Short explanation of the run quality'))
  .output(
    'quality',
    f.class(
      ['excellent', 'good', 'acceptable', 'poor', 'unacceptable'] as const,
      'Overall run quality tier'
    )
  )
  .build();

export const AX_AGENT_OPTIMIZE_PROGRAM_SIGNATURE: AxSignature<
  Record<'taskRecord', AxFieldValue>,
  Record<'agentRunReport', AxFieldValue>
> = f()
  .input(
    'taskRecord',
    f.json(
      'Full optimization task record, including the agent input and evaluation criteria'
    )
  )
  .output(
    'agentRunReport',
    f.json(
      'Agent run report containing completion type, clarification or final output, guidance log, action log, function calls, errors, and turn count'
    )
  )
  .build();

export function normalizeAgentEvalDataset<IN>(
  dataset: Readonly<AxAgentEvalDataset<IN>>
): AxNormalizedAgentEvalDataset<IN> {
  if ('train' in dataset) {
    return {
      train: dataset.train,
      validation: dataset.validation,
    };
  }

  return { train: dataset };
}

export function serializeForEval(value: unknown): AxFieldValue {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    try {
      return JSON.parse(JSON.stringify(value)) as AxFieldValue;
    } catch {
      return value.map((item) => serializeForEval(item));
    }
  }
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value)) as AxFieldValue;
    } catch {
      return String(value) as AxFieldValue;
    }
  }

  return String(value) as AxFieldValue;
}

export function normalizeActorJavascriptCode(code: string): string {
  let normalized = code.trim();

  // Strip <think>...</think> reasoning blocks (some models leak them into
  // structured output fields).
  normalized = normalized.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  // And orphan </think> closers, dropping any prose preceding them on the
  // same line — that prose is the reasoning that wasn't wrapped in a
  // matching opener.
  normalized = normalized.replace(/[^\n]*<\/think>/g, '').trim();

  // If the value contains a fenced code block anywhere (not necessarily at the
  // exact start/end), extract the *first* fenced block's contents. This handles
  // models that prefix their javascriptCode with prose / reasoning before the
  // ```javascript fence (e.g. GLM-5).
  const fencedBlock = normalized.match(
    /```(?:[A-Za-z0-9_-]+)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/
  );
  if (fencedBlock?.[1] !== undefined) {
    normalized = fencedBlock[1].trim();
  }

  // Then run the original loop to clean up any remaining edge fences.
  for (;;) {
    const before = normalized;

    normalized = normalized.replace(/^```(?:[A-Za-z0-9_-]+)?[ \t]*\r?\n/, '');
    normalized = normalized.replace(/\r?\n?```[ \t]*$/, '');
    normalized = normalized.trim();

    if (normalized === before) {
      return normalized;
    }
  }
}

export function buildAgentJudgeCriteria(additionalCriteria?: string): string {
  const builtInCriteria = `
Use the input field named "criteria" as the task-specific rubric for success.
- Reward actual task completion over polished wording.
- Reward correct tool choice and correct arguments.
- Penalize wrong tools, unnecessary retries, ignored tool errors, and contradictions between the final output and the function call trace.
- If completionType is askClarification, judge whether the clarification was necessary, precise, and limited to the missing information.
- Reward clarifications that identify the exact missing information instead of guessing.
- Penalize clarifications that are vague, unnecessary, or ask for information the agent could have gathered from available tools or context.
- If expectedOutput is present and completionType is final, compare the final output against it.
- If expectedActions is present, confirm that the functionCalls align with them.
- If forbiddenActions is present, strongly penalize any matching function calls.
- If recursiveTrace or recursiveStats are present, use them to judge decomposition quality, unnecessary fan-out, missed direct-answer opportunities, and cost efficiency.
`.trim();

  const extra = additionalCriteria?.trim();
  if (!extra) {
    return builtInCriteria;
  }

  return `${builtInCriteria}\n\nAdditional Evaluation Guidance:\n${extra}`;
}

export function buildAgentJudgeForwardOptions(
  options: Readonly<AxAgentJudgeOptions>
): AxProgramForwardOptions<string> {
  const {
    criteria: _criteria,
    description: _description,
    randomizeOrder: _randomizeOrder,
    ...forwardOptions
  } = options;

  return {
    ...forwardOptions,
    maxSteps: 1,
  };
}

export function mapAgentJudgeQualityToScore(quality: string): number {
  const normalized = quality.toLowerCase();
  if (normalized === 'excellent') return 1;
  if (normalized === 'good') return 0.8;
  if (normalized === 'acceptable') return 0.5;
  if (normalized === 'poor') return 0.2;
  if (normalized === 'unacceptable') return 0;
  return 0.5;
}

export function actionNameMatches(
  expectedName: string,
  call: Readonly<AxAgentEvalFunctionCall>
): boolean {
  return (
    call.qualifiedName === expectedName ||
    call.name === expectedName ||
    call.qualifiedName.endsWith(`.${expectedName}`)
  );
}

export function adjustEvalScoreForActions(
  score: number,
  task: Readonly<AxAgentEvalTask>,
  prediction: Readonly<AxAgentEvalPrediction>
): number {
  let adjusted = Math.max(0, Math.min(1, score));

  const expectedActions = task.expectedActions ?? [];
  if (expectedActions.length > 0) {
    const matched = expectedActions.filter((expectedName) =>
      prediction.functionCalls.some((call) =>
        actionNameMatches(expectedName, call)
      )
    ).length;
    adjusted *= 0.5 + 0.5 * (matched / expectedActions.length);
  }

  const forbiddenActions = task.forbiddenActions ?? [];
  if (
    forbiddenActions.some((expectedName) =>
      prediction.functionCalls.some((call) =>
        actionNameMatches(expectedName, call)
      )
    )
  ) {
    adjusted *= 0.2;
  }

  return Math.max(0, Math.min(1, adjusted));
}

export function resolveAgentOptimizeTargetIds(
  availablePrograms: readonly { id: string }[],
  target: Readonly<AxAgentOptimizeTarget>
): string[] {
  const availableIds = new Set(availablePrograms.map((program) => program.id));
  const hasRecursiveSlots = availableIds.has(
    AX_AGENT_RECURSIVE_TARGET_IDS.shared
  );
  const recursiveActorIds = [
    AX_AGENT_RECURSIVE_TARGET_IDS.shared,
    AX_AGENT_RECURSIVE_TARGET_IDS.root,
    AX_AGENT_RECURSIVE_TARGET_IDS.recursive,
    AX_AGENT_RECURSIVE_TARGET_IDS.terminal,
  ].filter((id) => availableIds.has(id));

  if (target === 'actor') {
    if (hasRecursiveSlots) {
      if (recursiveActorIds.length === 0) {
        throw new Error(
          'AxAgent.optimize(): recursive actor targets are not available'
        );
      }
      return recursiveActorIds;
    }
    if (!availableIds.has('root.actor')) {
      throw new Error('AxAgent.optimize(): root.actor is not available');
    }
    return ['root.actor'];
  }
  if (target === 'responder') {
    if (!availableIds.has('root.responder')) {
      throw new Error('AxAgent.optimize(): root.responder is not available');
    }
    return ['root.responder'];
  }
  if (target === 'all') {
    if (hasRecursiveSlots) {
      return [
        ...recursiveActorIds,
        ...(availableIds.has(AX_AGENT_RECURSIVE_TARGET_IDS.responder)
          ? [AX_AGENT_RECURSIVE_TARGET_IDS.responder]
          : []),
      ];
    }
    return [...availableIds];
  }

  const explicit = [...target];
  for (const id of explicit) {
    if (!availableIds.has(id)) {
      throw new Error(`AxAgent.optimize(): unknown target program ID "${id}"`);
    }
  }
  return explicit;
}
