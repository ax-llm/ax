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
      title: 'Telemetry, cost, caching, aborts, and debugging',
      prerequisites: [
        'agent-context-observability',
        'structured-validation-errors',
      ],
      summary:
        'Production programs need traces, token and cost accounting, cache policy, cancellation, bounded retries, and logs that explain behavior without exposing secrets. Debug output is evidence, not a substitute for tests.',
      example:
        'await program.forward(llm, input, { tracer, abortSignal, debug: true, contextCache });',
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
      title: 'Embeddings, media, audio, realtime, and thinking',
      prerequisites: ['ai-providers-models'],
      summary:
        'Ax provider clients expose embeddings, image and file inputs, transcription, speech, realtime audio, and model thinking controls. The signature still describes the application contract while provider support determines available media.',
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
      title: 'Model routing and fallback',
      prerequisites: ['ai-providers-models', 'production-observability'],
      summary:
        'Routers and balancers select models or providers based on capability, health, latency, price, or application policy. Fallback should preserve the contract and remain observable.',
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
      title: 'UCP webhooks and non-MCP events',
      prerequisites: ['event-runtime-core'],
      summary:
        'AxEventRuntime also handles authenticated webhooks, timers, queues, and application events. UCP adapters normalize commerce events into the same explicit wake/resume policy model.',
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
      apiSymbols: ['eventRuntime'],
    }),
    topic({
      id: 'security-and-languages',
      title: 'Security and generated language packages',
      prerequisites: [
        'mcp-auth-security',
        'task-continuation-security',
        'production-observability',
      ],
      summary:
        'Treat model output, tool results, resources, notifications, and catalog text as untrusted. TypeScript is the reference runtime; generated Python, Java, C++, Go, and Rust packages expose native surfaces for the shared Ax semantic contract.',
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
