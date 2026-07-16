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
      title: 'Notifications versus subscriptions',
      prerequisites: ['mcp-tasks-advanced'],
      summary:
        'A server may emit task, progress, logging, catalog, or resource events. Resource notifications require an explicit subscription; a subscription only delivers events and never grants model execution by itself.',
      example:
        'endpoint → catalog → subscription policy → event inbox → explicit route',
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
      title: 'Resource subscription policies',
      prerequisites: ['notifications-vs-subscriptions'],
      summary:
        'Resource subscriptions default to none. Trusted servers may use all; production systems usually use a selector or explicit URI list. Templates are never expanded or authorized automatically.',
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
      title: 'Catalog changes, reconnect, and ownership',
      prerequisites: ['subscription-policies'],
      summary:
        'List-change notifications refresh the catalog and reconcile selected concrete resources. Logical owners share subscriptions safely, and reconnect restores known intent exactly once without discarding prior good state on partial failure.',
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
      title: 'AxEventRuntime inbox, trust, stores, and sinks',
      prerequisites: ['notifications-vs-subscriptions', 'flow-operations'],
      summary:
        'Event sources publish normalized envelopes into an inbox. Policies authenticate, authorize, map, retry, dead-letter, and route events; callbacks never call a model directly.',
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
      title: 'observe, invalidate, wake, and resume',
      prerequisites: ['event-runtime-core'],
      summary:
        'observe records progress or logs, invalidate refreshes derived state, wake starts a typed target, and resume consumes an owned continuation. Only wake and resume invoke a model.',
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
      title: 'Task continuations, identity, and replay safety',
      prerequisites: ['event-actions', 'catalog-reconnect-ownership'],
      summary:
        'Progress and logs remain observational. input_required and terminal task events may resume only the continuation that owns the identity-scoped correlation key. Recorded envelopes make these transitions testable without a live server.',
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
