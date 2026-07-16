import { choice, topic } from '../helpers.mjs';

export const productionUnit = {
  id: 'production',
  number: 11,
  title: 'Ship AI systems you can operate',
  description:
    'Control cost, latency, fallbacks, security, media, telemetry, and failure handling in production.',
  sourceRefs: [
    'src/ax/skills/ax-ai.md',
    'src/ax/skills/ax-audio.md',
    'src/ax/skills/ax-agent-observability.md',
    'docs/SECURITY.md',
  ],
  examplePaths: [
    'src/examples/telemetry.ts',
    'src/examples/audio-chat.ts',
    'src/examples/ucp-webhook-wake-agent.ts',
  ],
  topics: [
    topic({
      id: 'production-observability',
      title: 'See failures, cost, and latency in production',
      minutes: 9,
      prerequisites: [
        'agent-context-observability',
        'structured-validation-errors',
      ],
      summary:
        'You add traces, usage and cost accounting, cache policy, cancellation, bounded retries, and safe logs. Debug output becomes evidence for tests and operations.',
      example:
        'await program.forward(llm, input, { tracer, abortSignal, debug: true, contextCache });',
      exampleSteps: [
        {
          label: 'Trace the run',
          note: 'tracer connects model and tool activity to the surrounding request.',
        },
        {
          label: 'Make cancellation possible',
          note: 'abortSignal lets callers stop work that is no longer useful.',
        },
        {
          label: 'Control repeated work',
          note: 'contextCache makes reuse an explicit operational policy.',
        },
      ],
      check: choice(
        'What should every long-running Ax operation accept?',
        [
          'A cancellation path and bounded operational limits',
          'An unbounded retry loop',
          'A browser-stored provider key',
        ],
        0,
        'Cancellation and explicit bounds make failures controllable.'
      ),
    }),
    topic({
      id: 'media-audio-thinking',
      title: 'Add images, audio, and model thinking',
      minutes: 10,
      prerequisites: ['ai-providers-models'],
      summary:
        'You declare images, files, audio, and other media in the program contract. Provider support determines which media and thinking controls are available.',
      example:
        "const reply = ax('question:string, image:image -> answer:string, speech:audio');",
      check: choice(
        'Where should media inputs and outputs be declared?',
        [
          'In typed signature fields supported by the provider',
          'Inside a hidden prompt comment',
          'As MCP session identity',
        ],
        0,
        'Media stays part of the explicit program contract.'
      ),
      apiSymbols: ['ai', 'ax'],
    }),
    topic({
      id: 'routing-fallback',
      title: 'Fall back without changing your app contract',
      minutes: 9,
      prerequisites: ['ai-providers-models', 'production-observability'],
      summary:
        'You route across models by capability, health, latency, price, or application policy. A fallback preserves the typed contract and remains observable.',
      example:
        'const llm = ai({ name: router, config: { model: preferredModel } });',
      check: choice(
        'What must remain stable across a provider fallback?',
        [
          'The program’s typed contract and observable policy',
          'The provider-specific raw response format',
          'The MCP session ID',
        ],
        0,
        'Routing changes the model boundary, not the application contract.'
      ),
      apiSymbols: ['ai'],
    }),
    topic({
      id: 'ucp-and-events',
      title: 'Route webhooks through the same event runtime',
      minutes: 9,
      prerequisites: ['event-runtime-core'],
      summary:
        'You route authenticated webhooks, timers, queues, and application events through AxEventRuntime. UCP commerce events use the same explicit wake and resume policy.',
      example:
        "route('order-updated').source('ucp.webhook').identity(verifyMerchant).wake(orderAgent)",
      check: choice(
        'Does AxEventRuntime require MCP as its source?',
        [
          'No; it also accepts webhooks, timers, queues, and application events',
          'Yes; every event must be MCP',
          'Only when a flow has no nodes',
        ],
        0,
        'The event runtime is protocol-neutral after ingress normalization.'
      ),
      apiSymbols: ['AxEventRuntime', 'eventRuntime'],
    }),
    topic({
      id: 'security-and-languages',
      title: 'Keep every language surface safe and consistent',
      minutes: 8,
      prerequisites: [
        'mcp-auth-security',
        'task-continuation-security',
        'production-observability',
      ],
      summary:
        'You treat model output, tool results, resources, notifications, and catalog text as untrusted. Generated language packages preserve the shared Ax contract through native APIs.',
      example:
        'authorize(identity, action, resource); validate(input); run(); verify(output);',
      check: choice(
        'What do generated Ax language packages preserve?',
        [
          'The shared Ax semantic contract through native language surfaces',
          'A transpiled TypeScript runtime in every process',
          'One universal provider API key',
        ],
        0,
        'AxIR-generated packages are native surfaces for shared semantics, not pretend TypeScript transpilation.'
      ),
    }),
  ],
};
