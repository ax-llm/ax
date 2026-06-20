---
title: "Ax"
description: "Stop writing prompt glue. Ax compiles typed signatures into reliable LLM calls — validation, streaming, tools, agents, audio, and optimization. TypeScript on npm today; Python, Java, C++, Go, and Rust generated and verified from the same core."
---

<!-- Shortcode calls must start at column 0: Hugo re-indents shortcode output
     to match call-site indentation, which corrupts pre/chroma content.
     scripts/check-website-links.mjs enforces this on the built HTML. -->

<div data-home-language-root data-active-language="typescript">
<section class="home-hero">
<div class="home-hero-copy">
  <p class="home-kicker">Ax</p>
  <h1>Stop writing prompt glue.</h1>
  <p class="home-lede">A one-line signature declares what goes in and what comes out. Ax turns it into the prompt, the parser, the validators, and the retry loop — and hands back typed data your code can trust. The same programming model in TypeScript, Python, Java, C++, Go, and Rust.</p>
  <div class="home-proof-row" aria-label="Ax highlights">
    <span><i class="home-proof-dot proof-blue" aria-hidden="true"></i>Structured outputs</span>
    <span><i class="home-proof-dot proof-violet" aria-hidden="true"></i>Tools and agents</span>
    <span><i class="home-proof-dot proof-teal" aria-hidden="true"></i>Audio + realtime</span>
    <span><i class="home-proof-dot proof-green" aria-hidden="true"></i>Evaluate and optimize</span>
  </div>
  <div class="home-actions">
    <a href="/typescript/quick-start/">Get started</a>
    <a class="home-button-secondary" href="https://github.com/ax-llm/ax">GitHub</a>
  </div>
</div>
<div class="home-hero-panel" aria-label="Ax signature runtime preview">
{{< home-code topic="classifier" group="hero" >}}
{{< home-output topic="classifier" title="Typed output" >}}
</div>
</section>

<div class="home-install-strip">
{{< home-language-controls >}}
  <div class="home-hero-stats" data-home-stats data-repo="ax-llm/ax" data-npm-package="@ax-llm/ax" aria-label="Project stats">
    <a href="https://github.com/ax-llm/ax" hidden><strong data-stat="stars"></strong><span>GitHub stars</span></a>
    <a href="https://www.npmjs.com/package/@ax-llm/ax" hidden><strong data-stat="downloads"></strong><span>npm downloads/week</span></a>
  </div>
</div>

<section class="home-install-section" aria-label="Install Ax">
<div class="home-install-block">
  <h2 class="home-install-heading">Install</h2>
{{< home-install >}}
</div>
<div class="home-agent-strip">
  <p><strong>Using Claude Code or Cursor?</strong> Point your coding agent at Ax — every language ships installable, versioned skills your agent can follow.</p>
{{< home-install field="skillsCommand" class="home-install-skills" label="Install Ax agent skills" >}}
  <a class="home-agent-strip-link" href="/typescript/skills/">Browse agent skills</a>
</div>
</section>

<nav class="home-paths" aria-label="Choose your path">
  <a href="/typescript/quick-start/"><strong>Quick Start</strong><span>Install Ax and run the smallest typed generation program.</span></a>
  <a href="/typescript/examples/"><strong>Examples</strong><span>No-key, provider, agent, MCP, flow, and optimization demos.</span></a>
  <a href="/typescript/skills/"><strong>Agent skills</strong><span>Point Claude Code or Cursor at installable Ax skills.</span></a>
  <a href="/typescript/concepts/signatures/"><strong>Signatures</strong><span>Learn why typed I/O contracts beat hand-built prompt strings.</span></a>
  <a href="/typescript/concepts/llms/"><strong>Audio</strong><span>Transcribe, speak, stream realtime audio, and return typed speech artifacts.</span></a>
  <a href="/typescript/concepts/agents/"><strong>Agents</strong><span>Tools, memory, child agents, runtime state, and discovery without prompt bloat.</span></a>
  <a href="/research/"><strong>Research</strong><span>The DSPy, GEPA, RLM, and PEEK papers behind the design.</span></a>
  <a href="/typescript/api/ax/"><strong>API Docs</strong><span>Curated references for the factory-style Ax API.</span></a>
</nav>

<section class="home-section home-code-story" aria-labelledby="why-signatures">
<div class="home-section-heading">
  <p class="home-section-label">Why signatures?</p>
  <h2 id="why-signatures">Describe the input and output. Ax handles the model call.</h2>
  <p>The hero demo is the whole philosophy. A signature says what data the model receives and what typed data your app expects back. Ax uses that one contract to render prompts, call providers, parse output, validate constraints, retry with feedback, stream partial results, record traces, seed examples, and optimize behavior later.</p>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <h3>The contract becomes the system boundary.</h3>
    <p>Instead of spreading prompt text, JSON parsing, retry logic, tool schemas, tracing, and eval metadata across your app, Ax hangs them from the signature.</p>
    <div class="home-badge-row"><span>Validation</span><span>Streaming</span><span>Tools</span><span>Traces</span><span>Optimization</span></div>
  </div>
  <div>
{{< svg "semantic-network" "Signature contract network" >}}
  </div>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <p class="home-section-label">Signature pipeline</p>
    <h3>One line becomes a running pipeline.</h3>
    <p>The signature you write is lowered into prompt rendering, streaming parsers, validators, retry feedback, and trace metadata — the same pipeline that produced the typed output above.</p>
  </div>
  <div>
{{< svg "signature-runtime" "Signature to runtime pipeline" >}}
  </div>
</div>
</section>

<section class="home-section home-compiler-section" aria-labelledby="compiler-ir">
<div class="home-section-heading">
  <p class="home-section-label">AxIR compiler</p>
  <h2 id="compiler-ir">We didn't port Ax six times. We compiled it.</h2>
  <p>Ax is built around a portable intermediate representation. TypeScript is the reference runtime; the AxIR compiler lowers signatures, schemas, providers, generators, agents, flows, MCP, and optimizers into one shared semantic core — then emits native package surfaces for Python, Java, C++, Go, and Rust. Native names, native errors, native builders. Same behavior.</p>
</div>
<div class="home-signature-grid">
  <article class="home-code-card">
    <div class="home-card-icon icon-violet" aria-hidden="true">S</div>
    <h3>Signature syntax</h3>
{{< home-code topic="signatureString" group="signature-string" compact="true" label="Signature syntax" >}}
    <p>String signatures become AxIR contracts that the compiler can lower into prompts, schemas, validators, examples, traces, and typed outputs.</p>
  </article>
  <article class="home-code-card">
    <div class="home-card-icon icon-teal" aria-hidden="true">F</div>
    <h3>Field schema IR</h3>
{{< home-code topic="signatureFluent" group="signature-fluent" compact="true" label="Field schema IR" >}}
    <p>Fluent fields, media types, arrays, enums, constraints, and validators preserve field semantics across native packages.</p>
  </article>
  <article class="home-code-card">
    <div class="home-card-icon icon-blue" aria-hidden="true">Z</div>
    <h3>Structured schema output</h3>
{{< home-code topic="signatureSchema" group="signature-schema" compact="true" label="Structured schema output" >}}
    <p>Schema-backed output keeps generated code aligned with the same parse, retry, docs, telemetry, and optimization contract.</p>
  </article>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <p class="home-section-label">Compiler pipeline</p>
    <h3>TypeScript reference runtime -> AxIR -> native APIs.</h3>
    <p>The package compiler emits language-shaped APIs instead of transpiling TypeScript. Each backend keeps native names, errors, builders, callbacks, transports, and runtime profiles while sharing the same Ax semantics.</p>
  </div>
  <div>
{{< svg "axir-compiler" "AxIR compiler pipeline" >}}
  </div>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <p class="home-section-label">Conformance gate</p>
    <h3>Capability manifests keep every backend honest.</h3>
    <p>Generated package examples, API metadata, capability manifests, and conformance fixtures are checked by <code>axir verify</code>. That is why the language switcher in the hero is a demo, not a promise — every backend earns its place in the matrix.</p>
  </div>
  <div>
{{< svg "language-matrix" "Language package matrix" >}}
  </div>
</div>
{{< backend-badges >}}
</section>

<section class="home-section home-research-section" aria-labelledby="research">
<div class="home-section-heading home-section-heading-wide">
  <p class="home-section-label">The ideas behind it</p>
  <h2 id="research">Built on DSPy, GEPA, RLM, and PEEK.</h2>
  <p>Ax is more than another LLM framework — it is where a serious research lineage ships. The typed signatures, validation with retry feedback, reflective optimization, runtime-backed agents, and context maps you just saw all come from these papers.</p>
</div>
<div class="home-research-list home-research-compact">
  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h3><a href="https://arxiv.org/abs/2310.03714">DSPy: Compiling Declarative Language Model Calls into Self-Improving Pipelines</a></h3></div>
      <p class="paper-authors">Omar Khattab et al.</p>
      <p>Declarative modules, signatures, examples, and self-improving LLM pipelines shape Ax's programming model.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2310.03714">arXiv 2310.03714</a>
      <div class="paper-logo-row"><span class="paper-logo-mark paper-logo-stanford">Stanford</span></div>
    </div>
  </article>
  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h3><a href="https://arxiv.org/abs/2312.13382">DSPy Assertions: Computational Constraints for Self-Refining Language Model Pipelines</a></h3></div>
      <p class="paper-authors">Arnav Singhvi et al.</p>
      <p>Constraints, validation, and self-refinement inform Ax signatures, schemas, retry feedback, and output reliability.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2312.13382">arXiv 2312.13382</a>
      <div class="paper-logo-row"><span class="paper-logo-mark paper-logo-stanford">Stanford</span></div>
    </div>
  </article>
  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h3><a href="https://arxiv.org/abs/2507.19457">GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning</a></h3></div>
      <p class="paper-authors">Lakshya A. Agrawal et al.</p>
      <p>Reflective prompt evolution and Pareto tradeoffs map directly to Ax optimization for generators, flows, and agents.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2507.19457">arXiv 2507.19457</a>
      <div class="paper-logo-row"><span class="paper-logo-mark paper-logo-stanford">Stanford</span><span class="paper-logo-mark paper-logo-berkeley">Berkeley</span></div>
    </div>
  </article>
  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h3><a href="https://arxiv.org/abs/2512.24601">Recursive Language Models</a></h3></div>
      <p class="paper-authors">Alex L. Zhang, Tim Kraska, Omar Khattab.</p>
      <p>External runtime loops and recursive model calls inform AxAgent's runtime state, execution boundary, and small-context turns.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2512.24601">arXiv 2512.24601</a>
      <div class="paper-logo-row"><span class="paper-logo-mark paper-logo-mit">MIT</span><span class="paper-logo-mark paper-logo-stanford">Stanford</span></div>
    </div>
  </article>
  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h3><a href="https://arxiv.org/abs/2605.19932">PEEK: Context Map as an Orientation Cache for Long-Context LLM Agents</a></h3></div>
      <p class="paper-authors">Zhuohan Gu et al.</p>
      <p>Persistent context maps and orientation caches are the product instinct behind Ax memory, skills, and context management.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2605.19932">arXiv 2605.19932</a>
      <div class="paper-logo-row"><span class="paper-logo-mark paper-logo-mit">MIT</span><span class="paper-logo-mark paper-logo-stanford">Stanford</span></div>
    </div>
  </article>
</div>
<div class="home-actions home-section-actions">
  <a href="/research/">Read the research map</a>
</div>
</section>

<section class="home-section home-agent-section" aria-labelledby="agents-that-work">
<div class="home-section-heading home-agent-heading">
  <p class="home-section-label">Agents</p>
  <h2 id="agents-that-work">Agents built for context, tools, memory, and code.</h2>
  <p>AxAgent is designed around DSPy, RLM, and PEEK ideas: typed signatures define the job, generated code and host runtimes hold durable state, context maps drive context management, and discovery-based tools load only the schemas needed for the next action. That keeps agents useful with small models and big ones, while built-in memory, skills, child agents, telemetry, and <code>agent.optimize(...)</code> make them practical to operate.</p>
</div>
<div class="home-agent-code">
{{< home-code topic="agent" group="agent" >}}
</div>
<div class="home-agent-layout">
  <div class="home-chart-panel">
{{< svg "rlm-loop" "RLM loop" >}}
  </div>
  <div class="home-agent-feature-grid">
    <article><h3>Discovery</h3><p>Large tool catalogs stay out of the base prompt. The agent discovers groups and loads concrete schemas only when they matter.</p></article>
    <article><h3>Context maps</h3><p>Runtime state, context maps, summaries, and checkpoints preserve orientation without replaying every token.</p></article>
    <article><h3>Memory + skills</h3><p>Built-in memory, skills, MCP tools, and child agents become typed capabilities behind the same signature contract.</p></article>
    <article><h3>Optimization</h3><p><code>agent.optimize(...)</code> tunes instructions, examples, and agent behavior against evals, judges, and saved artifacts.</p></article>
  </div>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <p class="home-section-label">Function discovery</p>
    <h3>Agents navigate large tool catalogs without stuffing every schema into the prompt.</h3>
    <p>Function groups, child agents, MCP tools, memory, and runtime state are discovered and loaded as needed, which keeps even small models focused on the next useful action.</p>
  </div>
  <div>
{{< svg "agent-tree" "Agent function discovery tree" >}}
  </div>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <p class="home-section-label">Context policy</p>
    <h3>State grows in the runtime instead of the prompt.</h3>
    <p>Context maps, summaries, checkpoint state, and runtime references keep long-running work usable without turning every turn into a full transcript replay.</p>
  </div>
  <div>
{{< svg "context-growth" "Context growth chart" >}}
  </div>
</div>
<div class="home-actions home-section-actions">
  <a href="/typescript/concepts/agents/">Explore agents</a>
  <a class="home-button-secondary" href="/typescript/concepts/optimization/">Optimization guide</a>
</div>
</section>

<section class="home-section home-audio-section" aria-labelledby="audio">
<div class="home-section-heading">
  <p class="home-section-label">Audio</p>
  <h2 id="audio">Build text, voice, and realtime AI apps.</h2>
  <p>Ax treats audio as part of the same typed programming model: direct speech-to-text, direct text-to-speech, signature audio artifacts, conversational audio turns, realtime/native audio, and agent audio inputs.</p>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <h3>Use the smallest audio surface that matches the job.</h3>
    <ul class="home-method-list">
      <li><code>ai.transcribe(...)</code> for batch speech-to-text.</li>
      <li><code>ai.speak(...)</code> for batch text-to-speech.</li>
      <li><code>speech:audio</code> for typed programs that return synthesized audio artifacts.</li>
      <li><code>.chat()</code> audio config for conversational or realtime audio turns.</li>
      <li>Agents transcribe audio inputs before planner, executor, and responder stages.</li>
    </ul>
    <p><a href="/typescript/concepts/llms/">Read the LLM guide</a> or <a href="/typescript/examples/#llm-media">open media examples</a>.</p>
  </div>
  <div>
{{< home-code topic="audio" group="audio" >}}
  </div>
</div>
<div class="home-card-grid three-up">
  <article class="home-marketing-card">{{< home-icon "activity" "icon-blue" >}}<h3>Transcribe and speak</h3><p>Use direct batch APIs when the app needs speech-to-text, text-to-speech, transcripts, or reusable audio artifacts.</p></article>
  <article class="home-marketing-card">{{< home-icon "message-circle" "icon-teal" >}}<h3>Conversational audio</h3><p>Use provider audio chat and realtime configurations when voice belongs inside the model conversation.</p></article>
  <article class="home-marketing-card">{{< home-icon "brain" "icon-green" >}}<h3>Agent audio</h3><p>Let agents accept recordings and return spoken outputs while their internal tool loops operate on stable text.</p></article>
</div>
</section>

<section class="home-section" aria-labelledby="optimize-frontiers">
<div class="home-section-heading">
  <p class="home-section-label">Optimization</p>
  <h2 id="optimize-frontiers">Improve quality after it works.</h2>
  <p>GEPA, the Genetic-Pareto optimizer, tunes prompts, demos, flows, and agents against evals. Pareto frontiers make quality, latency, cost, and brevity tradeoffs explicit instead of hiding them behind one metric.</p>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <h3>Pick the artifact that matches production reality.</h3>
    <p>Use optimized programs when quality matters, cheaper frontier points when cost dominates, and saved artifacts when the same tuned behavior needs to be deployed repeatedly.</p>
    <p><a href="/typescript/concepts/optimization/">Read optimization docs</a> or <a href="/typescript/api/optimize/">open the optimize API</a>.</p>
  </div>
  <div>
{{< svg "pareto-frontier" "GEPA Pareto frontier" >}}
  </div>
</div>
</section>

<section class="home-section" aria-labelledby="included">
<div class="home-section-heading home-section-heading-wide">
  <p class="home-section-label">The full surface</p>
  <h2 id="included">Everything you need to build useful LLM systems.</h2>
  <p>Every capability above hangs off the same signature contract. Start with a single typed generation call, then grow into tools, agents, voice, workflows, telemetry, optimization, and native packages without switching mental models.</p>
</div>
<div class="home-capability-grid">
  <article class="home-marketing-card">{{< home-icon "zap" "icon-blue" >}}<h3>Structured generation <span>ax()</span></h3><p>Declare typed inputs and outputs, then get parsed host values with streaming, validation, retries, and traces.</p></article>
  <article class="home-marketing-card">{{< home-icon "tags" "icon-violet" >}}<h3>Signatures <span>s() + f()</span></h3><p>Use concise string signatures, fluent fields, media types, enums, arrays, constraints, and Standard Schema output.</p></article>
  <article class="home-marketing-card">{{< home-icon "bot" "icon-green" >}}<h3>Tools and MCP <span>fn()</span></h3><p>Expose typed host functions, MCP servers, runtimes, flows, and child agents as callable capabilities.</p></article>
  <article class="home-marketing-card">{{< home-icon "brain" "icon-teal" >}}<h3>Agents <span>agent()</span></h3><p>Build agents with tool discovery, memory, skills, child agents, context policy, and persistent runtime state.</p></article>
  <article class="home-marketing-card home-audio-card">{{< home-icon "activity" "icon-amber" >}}<h3>Audio <span>speech:audio</span></h3><p>Transcribe speech, synthesize speech, return typed audio artifacts, and use conversational or realtime audio turns.</p></article>
  <article class="home-marketing-card">{{< home-icon "list-checks" "icon-teal" >}}<h3>Workflows <span>flow()</span></h3><p>Compose typed steps, branches, and parallel work into explicit LLM application flows.</p></article>
  <article class="home-marketing-card">{{< home-icon "bar-chart" "icon-rust" >}}<h3>Optimization <span>optimize()</span></h3><p>Improve prompts, demos, programs, flows, and agents against evals, judges, and production tradeoffs.</p></article>
  <article class="home-marketing-card">{{< home-icon "globe" "icon-blue" >}}<h3>Providers <span>ai()</span></h3><p>Use OpenAI, Responses, Claude, Gemini, OpenAI-compatible gateways, local routers, embeddings, and model catalogs.</p></article>
  <article class="home-marketing-card">{{< home-icon "activity" "icon-violet" >}}<h3>Telemetry <span>traces</span></h3><p>Inspect model calls, tool calls, usage, cost, latency, errors, optimizer metrics, and agent turns.</p></article>
  <article class="home-marketing-card">{{< home-icon "languages" "icon-green" >}}<h3>Native packages <span>AxIR</span></h3><p>Use the same Ax concepts from TypeScript, Python, Java, C++, Go, and Rust package surfaces.</p></article>
</div>
</section>

<section class="home-section" aria-labelledby="production-ready">
<div class="home-section-heading">
  <p class="home-section-label">Production-ready from day one</p>
  <h2 id="production-ready">The operational pieces are built in, not bolted on.</h2>
  <p>Extensive test coverage, OpenTelemetry integration, cost tracking, provider routing, and enterprise-grade error handling all belong to one program story.</p>
</div>
<div class="home-stats" aria-label="Ax production highlights">
  <div><strong>1000+</strong><span>tests</span></div>
  <div><strong>40+</strong><span>OTel metrics</span></div>
  <div><strong>15+</strong><span>LLM providers</span></div>
  <div><strong>6</strong><span>languages</span></div>
</div>
<div class="home-card-grid production-grid">
  <article class="home-marketing-card">{{< home-icon "activity" "icon-blue" >}}<h3>OpenTelemetry</h3><p>Distributed traces span LLM calls, function invocations, MCP calls, and agent turns.</p></article>
  <article class="home-marketing-card">{{< home-icon "bar-chart" "icon-teal" >}}<h3>Detailed metrics</h3><p>Track latency, tokens, errors, context windows, thinking budgets, and custom labels.</p></article>
  <article class="home-marketing-card">{{< home-icon "zap" "icon-violet" >}}<h3>Streaming and validation</h3><p>Structured outputs stream through parsers, assertions, retries, and correction feedback.</p></article>
  <article class="home-marketing-card">{{< home-icon "dollar" "icon-green" >}}<h3>Cost tracking</h3><p>Estimate provider costs per request and make optimization tradeoffs concrete.</p></article>
  <article class="home-marketing-card">{{< home-icon "globe" "icon-amber" >}}<h3>Multi-language</h3><p>One semantic core spans TypeScript, Python, Java, C++, Go, and Rust package shapes.</p></article>
  <article class="home-marketing-card">{{< home-icon "shield" "icon-rust" >}}<h3>Enterprise controls</h3><p>Rate limits, sampling, redaction, provider routing, and error handling fit production workflows.</p></article>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <p class="home-section-label">Operate Ax systems</p>
    <h3>Observe the run from model call to optimized artifact.</h3>
    <p>Use the telemetry guide for the concrete spans, counters, histograms, and labels emitted by Ax programs.</p>
    <p><a href="/typescript/concepts/telemetry/">Read telemetry docs</a>.</p>
  </div>
  <div>
{{< svg "production-loop" "Production telemetry loop" >}}
  </div>
</div>
</section>

<section class="home-section" aria-labelledby="declare-capabilities">
<div class="home-section-heading">
  <p class="home-section-label">Patterns</p>
  <h2 id="declare-capabilities">Declare capabilities, not prompts.</h2>
  <p>Signatures make common LLM tasks readable, testable, and portable. The contract is the unit Ax can validate, trace, optimize, and document.</p>
</div>
<div class="home-pattern-grid">
  <article>{{< home-icon "tags" "icon-violet" >}}<h3>Classification</h3><p>Categorize text into predefined classes.</p>{{< home-code topic="patterns.classification" group="pattern-classification" compact="true" label="Classification" >}}</article>
  <article>{{< home-icon "file-text" "icon-teal" >}}<h3>Extraction</h3><p>Pull structured data from unstructured text.</p>{{< home-code topic="patterns.extraction" group="pattern-extraction" compact="true" label="Extraction" >}}</article>
  <article>{{< home-icon "message-circle" "icon-green" >}}<h3>Question answering</h3><p>Answer questions with provided context.</p>{{< home-code topic="patterns.qa" group="pattern-qa" compact="true" label="Question answering" >}}</article>
  <article>{{< home-icon "image" "icon-amber" >}}<h3>Multimodal</h3><p>Process images and audio alongside text.</p>{{< home-code topic="patterns.multimodal" group="pattern-multimodal" compact="true" label="Multimodal" >}}</article>
  <article>{{< home-icon "shield" "icon-rust" >}}<h3>Validation</h3><p>Auto-validate outputs with constraints.</p>{{< home-code topic="patterns.validation" group="pattern-validation" compact="true" label="Validation" >}}</article>
  <article>{{< home-icon "zap" "icon-blue" >}}<h3>Streaming</h3><p>Receive structured results as they generate.</p>{{< home-code topic="patterns.streaming" group="pattern-streaming" compact="true" label="Streaming" >}}</article>
  <article>{{< home-icon "languages" "icon-violet" >}}<h3>Translation</h3><p>Translate between languages with typed IO.</p>{{< home-code topic="patterns.translation" group="pattern-translation" compact="true" label="Translation" >}}</article>
  <article>{{< home-icon "list-checks" "icon-teal" >}}<h3>Workflows</h3><p>Return multiple typed outputs from one call.</p>{{< home-code topic="patterns.workflows" group="pattern-workflows" compact="true" label="Workflows" >}}</article>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <p class="home-section-label">MCP and tools</p>
    <h3>External servers become typed Ax functions.</h3>
    <p>Use MCP servers through <code>AxMCPClient.toFunction()</code> in <code>ax()</code> generation or pass MCP clients into agents for discovery-aware tool use.</p>
    <p><a href="/typescript/concepts/mcp/">Read the MCP guide</a> or <a href="/typescript/concepts/tools/">open the tools guide</a>.</p>
  </div>
  <div>
{{< svg "mcp-bridge" "MCP bridge" >}}
  </div>
</div>
</section>

<section class="home-section home-model-section" aria-labelledby="use-any-model">
<div class="home-section-heading">
  <p class="home-section-label">LLM providers</p>
  <h2 id="use-any-model">Use any model.</h2>
  <p>Pick OpenAI, Claude, Gemini, a gateway, or a local OpenAI-compatible endpoint in <code>ai()</code>. Your signatures, tools, traces, and outputs stay the same.</p>
</div>
<div class="home-provider-layout home-provider-layout-simple">
  <div>
    <div class="home-provider-strip" aria-label="Supported provider examples">
      <span>OpenAI</span>
      <span>Claude</span>
      <span>Gemini</span>
      <span>OpenAI-compatible</span>
      <span>Local</span>
    </div>
{{< home-code topic="provider" group="provider" compact="true" label="Provider setup" >}}
    <p class="home-inline-note">Need routing, embeddings, audio, or context caching? <a href="/typescript/concepts/llms/">Read the LLM guide</a>.</p>
  </div>
  <div class="home-provider-visual">
{{< svg "provider-router" "Provider router map" >}}
  </div>
</div>
</section>

<section class="home-section home-graphjin" aria-labelledby="graphjin">
<div class="home-section-heading">
  <p class="home-section-label">Also checkout</p>
  <h2 id="graphjin">Connect AI agents to your database.</h2>
  <p><a href="https://graphjin.com">GraphJin</a> compiles GraphQL to efficient SQL and doubles as an MCP server, giving Ax agents direct, governed access to application data.</p>
</div>
<div class="home-graphjin-layout">
  <div class="home-graphjin-code">
{{< home-code topic="graphjin" group="graphjin" compact="true" label="GraphJin MCP" >}}
  </div>
  <div class="home-graphjin-copy">
    <h3>Use GraphJin as an MCP tool inside Ax agents.</h3>
    <p>PostgreSQL, MySQL, SQLite, MongoDB, Oracle, MSSQL, and Snowflake can sit behind one data access layer for AI workflows.</p>
    <div class="home-badge-row">
      <span>PostgreSQL</span><span>MySQL</span><span>SQLite</span><span>MongoDB</span><span>Snowflake</span>
    </div>
    <div class="home-actions home-section-actions">
      <a href="https://graphjin.com">Explore GraphJin</a>
      <a class="home-button-secondary" href="https://github.com/dosco/graphjin">GitHub</a>
    </div>
  </div>
</div>
</section>

<section class="home-section home-final-cta" aria-labelledby="get-started">
<div class="home-section-heading">
  <p class="home-section-label">Start now</p>
  <h2 id="get-started">Write your first signature today.</h2>
  <p>One line in, typed data out — on npm now, and in five more languages straight from this repo.</p>
</div>
<div class="home-actions">
  <a href="/typescript/quick-start/">Get started</a>
  <a class="home-button-secondary" href="/typescript/examples/">Examples</a>
  <a class="home-button-secondary" href="https://github.com/ax-llm/ax">GitHub</a>
</div>
<p class="home-inline-note">Building with an AI coding agent? <a href="/typescript/skills/">Install the Ax skills</a> and let it write Ax for you.</p>
</section>
</div>
