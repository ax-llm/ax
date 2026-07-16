import { choice, topic } from '../helpers.mjs';

export const notificationsUnit = {
  id: 'notifications',
  number: 10,
  title: 'React safely to live events',
  description:
    'Turn updates and remote task events into durable, authorized agent wake-ups and resumptions.',
  sourceRefs: [
    'src/ax/skills/ax-event-runtime.md',
    'docs/MCP_SUBSCRIPTIONS.md',
    'docs/EVENT_RUNTIME.md',
  ],
  examplePaths: [
    'src/examples/typescript/mcp/resource-wake-agent.ts',
    'src/examples/typescript/mcp/task-resume-flow.ts',
  ],
  topics: [
    topic({
      id: 'notifications-vs-subscriptions',
      title: 'Separate incoming updates from agent work',
      minutes: 7,
      prerequisites: ['mcp-tasks-advanced'],
      summary:
        'You treat delivery and model execution as separate decisions. A resource subscription receives updates but never grants an agent permission to run.',
      example:
        'endpoint → catalog → subscription policy → event inbox → explicit route',
      exampleSteps: [
        {
          label: 'Discover the endpoint',
          note: 'The live catalog identifies concrete resources and supported event capabilities.',
        },
        {
          label: 'Apply subscription policy',
          note: 'Your application chooses which updates it actually wants.',
        },
        {
          label: 'Route through the inbox',
          note: 'An explicit event route decides whether the update only records state or wakes work.',
        },
      ],
      check: choice(
        'Does an MCP resource subscription automatically run an agent?',
        [
          'No; an explicit wake route is still required',
          'Yes; every update invokes the model',
          'Only when progress is zero',
        ],
        0,
        'Delivery and execution are deliberately separate safety boundaries.'
      ),
      apiSymbols: ['AxMCPClient'],
    }),
    topic({
      id: 'subscription-policies',
      title: 'Subscribe only to the resources you need',
      minutes: 8,
      prerequisites: ['notifications-vs-subscriptions'],
      summary:
        'You start with no resource subscriptions and opt into a selector or explicit URI list. Templates are never expanded or authorized automatically.',
      example:
        "resourceSubscriptions: { selector: resource => resource.uri.startsWith('orders://') }",
      check: choice(
        'What is the default resource subscription policy?',
        ['none', 'all', 'every URI template'],
        0,
        'Ax requires explicit resource subscription intent.'
      ),
    }),
    topic({
      id: 'catalog-reconnect-ownership',
      title: 'Restore subscriptions safely after reconnecting',
      minutes: 9,
      prerequisites: ['subscription-policies'],
      summary:
        'You reconcile catalog changes and restore known subscription intent exactly once after reconnecting. Partial failure keeps the prior known-good ownership state.',
      example:
        'notifications/resources/list_changed → refresh catalog → diff selection → subscribe additions → unsubscribe removals',
      check: choice(
        'What should happen if a selector fails during a catalog change?',
        [
          'Keep the prior known-good selection and retry later',
          'Drop every subscription immediately',
          'Wake every agent',
        ],
        0,
        'Failing closed on the new selection should not destroy known-good ownership state.'
      ),
    }),
    topic({
      id: 'event-runtime-core',
      title: 'Give events one safe front door',
      minutes: 10,
      apiLabel: 'AxEventRuntime',
      prerequisites: ['notifications-vs-subscriptions', 'flow-operations'],
      summary:
        'You publish normalized events into an inbox where policies authenticate, authorize, retry, dead-letter, and route them. Source callbacks never call a model directly.',
      example:
        "const runtime = eventRuntime({ store, sink }).route(route('orders').source('mcp.resource').wake(target));",
      check: choice(
        'Where should a notification callback put work?',
        [
          'Into the event inbox for policy-controlled routing',
          'Directly into a model call',
          'Into the provider model enum',
        ],
        0,
        'Durable ingress separates protocol timing from application execution.'
      ),
      apiSymbols: ['eventRuntime', 'AxEventRuntime'],
    }),
    topic({
      id: 'event-actions',
      title: 'Choose whether an event observes or acts',
      minutes: 8,
      apiLabel: 'wake() · resume()',
      prerequisites: ['event-runtime-core'],
      summary:
        'You choose an explicit action for every route: observe, invalidate, wake, or resume. Only wake and resume may invoke a model.',
      example:
        "route('resource-updated').source('mcp.resource').identity(requireAccount).wake(target)",
      check: choice(
        'Which event actions may invoke a model?',
        [
          'wake and resume',
          'observe and invalidate',
          'catalog refresh and logging',
        ],
        0,
        'Model execution stays explicit at wake/resume routes.'
      ),
      apiSymbols: ['eventRuntime'],
    }),
    topic({
      id: 'task-continuation-security',
      title: 'Resume only the task that owns the event',
      minutes: 10,
      prerequisites: ['event-actions', 'catalog-reconnect-ownership'],
      summary:
        'You let input-required and terminal events resume only their identity-scoped owning continuation. Recorded envelopes make that boundary testable without a live server.',
      example:
        'mcp.task:orders:task-42 → verify identity owner → atomically consume continuation → resume target',
      check: choice(
        'Which continuation may a terminal MCP task notification resume?',
        [
          'Only the identity-scoped owner of its correlation key',
          'Any waiting flow',
          'Every agent sharing the client',
        ],
        0,
        'Ownership prevents cross-tenant or cross-run resume.'
      ),
      apiSymbols: ['eventRuntime', 'AxEventRuntime'],
    }),
  ],
};
