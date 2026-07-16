import { choice, code, topic } from '../helpers.mjs';

export const optimizationUnit = {
  id: 'optimization',
  number: 8,
  title: 'Measure and improve AI quality',
  description:
    'Evaluate real tasks, optimize prompts and tool use, and retain lessons from verified failures.',
  sourceRefs: [
    'src/ax/skills/ax-agent-optimize.md',
    'src/ax/skills/ax-gepa.md',
    'src/ax/skills/ax-playbook.md',
    'src/ax/skills/ax-refine.md',
  ],
  examplePaths: [
    'src/examples/axagent-gepa-optimization.ts',
    'src/examples/refine.ts',
  ],
  topics: [
    topic({
      id: 'evals-metrics-judges',
      title: 'Evaluation datasets, metrics, judges, and replay',
      prerequisites: ['examples-metrics-loop', 'agent-context-observability'],
      summary:
        'A useful evaluation records inputs, criteria, expected or forbidden actions, predictions, and traces. Prefer deterministic metrics when possible; use judges when quality requires holistic review.',
      example:
        "const tasks = [{ input: { request: 'Refund order 42' }, criteria: 'Verify eligibility before refunding', expectedActions: ['orders.lookup'] }];",
      check: choice(
        'When should you prefer a deterministic metric?',
        [
          'When the expected answer or action can be checked directly',
          'Whenever the output is prose',
          'Only for MCP notifications',
        ],
        0,
        'Deterministic metrics are cheaper and more reproducible when the target is explicit.'
      ),
    }),
    topic({
      id: 'optimize-gen-flow',
      title: 'Optimize generators and workflows',
      prerequisites: [
        'evals-metrics-judges',
        'structured-validation-errors',
        'flow-operations',
      ],
      summary:
        'The language optimizer surface tunes ordinary generators and flows from examples and a metric. Bound metric calls, keep validation examples separate, and apply the returned artifact through the program API.',
      example:
        'const result = await optimize(program, train, metric, { studentAI, teacherAI, maxMetricCalls: 40 });',
      check: code(
        'Which top-level factory tunes AxGen and AxFlow? Enter only its name.',
        'optimize',
        'Use optimize() for normal generator and flow tuning.'
      ),
      apiSymbols: ['optimize'],
    }),
    topic({
      id: 'agent-optimize',
      title: 'Optimize agent behavior',
      prerequisites: ['evals-metrics-judges', 'agent-core'],
      summary:
        'Agent optimization evaluates the whole agent pipeline and can tune actor or responder components. Task records should exercise tool selection, clarification, delegation, and final quality.',
      example:
        "const result = await assistant.optimize(tasks, { target: 'actor', maxMetricCalls: 40 });",
      check: choice(
        'Which path should tune tool use and clarification behavior?',
        [
          'The agent optimization API',
          'A manual edit to the final answer',
          'MCP catalog refresh',
        ],
        0,
        'Agent-specific optimization evaluates runtime behavior, not just one generation call.'
      ),
      apiSymbols: ['agent'],
    }),
    topic({
      id: 'gepa-pareto-artifacts',
      title: 'GEPA, Pareto tradeoffs, budgets, and artifacts',
      prerequisites: ['optimize-gen-flow', 'agent-optimize'],
      summary:
        'GEPA reflects on failures and mutates optimizable components. Multi-objective runs can return a Pareto frontier, making tradeoffs such as quality, cost, latency, or brevity visible instead of pretending one candidate wins everything.',
      example:
        "const result = await optimize(program, train, metric, { maxMetricCalls: 80, objectives: ['accuracy', 'brevity'] });",
      check: choice(
        'What does a Pareto frontier preserve?',
        [
          'Candidates representing different non-dominated tradeoffs',
          'Only the longest prompt',
          'Every failed provider request',
        ],
        0,
        'Pareto results expose meaningful tradeoffs between objectives.'
      ),
      apiSymbols: ['optimize', 'AxGEPA'],
    }),
    topic({
      id: 'playbook-learning',
      title: 'Online and verified playbook learning',
      prerequisites: ['agent-optimize', 'peek-orientation'],
      summary:
        'Playbooks accumulate reusable situational guidance. update() trusts one live feedback item; evolve() mines a task set and keeps only grounded bullets that improve held-in performance without unacceptable held-out regression.',
      example:
        "await assistant.playbook().update({ example, prediction, feedback: 'Verify policy before acting.' });",
      check: choice(
        'How is a playbook different from optimize()?',
        [
          'It accumulates reusable situational lessons in runtime context',
          'It replaces the output signature',
          'It subscribes to MCP resources',
        ],
        0,
        'Optimization tunes components; playbooks grow durable task guidance.'
      ),
      apiSymbols: ['playbook', 'agent'],
    }),
    topic({
      id: 'refine-selection',
      title: 'Refine and quality-versus-cost selection',
      prerequisites: ['evals-metrics-judges'],
      summary:
        'refine() is useful when the program should generate, critique, and select or improve candidates at run time. It is distinct from offline GEPA optimization and from long-lived playbook learning.',
      example:
        'const improved = await refine(program, llm, input, { metric, rounds: 2 });',
      check: choice(
        'When is refine() a better fit than a full offline optimization run?',
        [
          'When one runtime request should generate and improve candidates',
          'When you need durable MCP subscription ownership',
          'When no metric or selection rule exists',
        ],
        0,
        'Refinement spends runtime compute on the current request; optimization changes reusable program artifacts.'
      ),
      apiSymbols: ['refine'],
    }),
  ],
};
