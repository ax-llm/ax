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
      title: 'Test AI behavior on real examples',
      minutes: 9,
      prerequisites: ['examples-metrics-loop', 'agent-context-observability'],
      summary:
        'You record realistic inputs, criteria, expected or forbidden actions, predictions, and traces. Use deterministic metrics when possible and judges when quality needs holistic review.',
      example:
        "const tasks = [{ input: { request: 'Refund order 42' }, criteria: 'Verify eligibility before refunding', expectedActions: ['orders.lookup'] }];",
      exampleSteps: [
        {
          label: 'Use a realistic input',
          note: 'The refund request represents the kind of task the agent will face.',
        },
        {
          label: 'Write the success rule',
          note: 'criteria explains that eligibility must be verified before action.',
        },
        {
          label: 'Record observable behavior',
          note: 'expectedActions lets the evaluation check tool selection, not only final prose.',
        },
      ],
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
      title: 'Improve a generator or workflow with data',
      minutes: 10,
      apiLabel: 'optimize()',
      prerequisites: [
        'evals-metrics-judges',
        'structured-validation-errors',
        'flow-operations',
      ],
      summary:
        'You tune a generator or workflow from examples and a metric. Bound the budget, keep validation data separate, and apply the returned artifact through the program API.',
      example:
        'const result = await optimize(program, train, metric, { studentAI, teacherAI, maxMetricCalls: 40 });',
      check: code(
        'Which top-level factory tunes AxGen and AxFlow? Enter only its name.',
        'optimize',
        'Use optimize() for normal generator and flow tuning.'
      ),
      apiSymbols: ['AxFlow', 'AxGen', 'optimize'],
    }),
    topic({
      id: 'agent-optimize',
      title: 'Improve how an agent chooses and acts',
      minutes: 11,
      apiLabel: 'optimize()',
      prerequisites: ['evals-metrics-judges', 'agent-core'],
      summary:
        'You evaluate the whole agent pipeline and tune its actor or responder. Good task records exercise tool choice, clarification, delegation, and final quality.',
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
      title: 'Compare better prompts without one fake winner',
      minutes: 12,
      apiLabel: 'AxGEPA',
      prerequisites: ['optimize-gen-flow', 'agent-optimize'],
      summary:
        'You let GEPA reflect on failures and change optimizable components. A Pareto frontier keeps honest tradeoffs between quality, cost, latency, and brevity visible.',
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
      title: 'Turn verified runs into reusable guidance',
      minutes: 9,
      apiLabel: 'playbook()',
      prerequisites: ['agent-optimize', 'peek-orientation'],
      summary:
        'You accumulate situational guidance from live feedback or a verified task set. Evolution keeps grounded advice that improves performance without unacceptable held-out regression.',
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
      apiSymbols: ['playbook', 'agent', 'optimize'],
    }),
    topic({
      id: 'refine-selection',
      title: 'Trade extra model work for a better answer',
      minutes: 8,
      apiLabel: 'refine()',
      prerequisites: ['evals-metrics-judges'],
      summary:
        'You use refine() when one request should generate, critique, and improve candidates at runtime. It is separate from offline optimization and long-lived playbook learning.',
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
