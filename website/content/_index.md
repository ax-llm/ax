---
title: "Ax"
description: "Build AI features and agents with DSPy-style programming, RLM agents, and one compiled framework. Native libraries for TypeScript, Python, Java, C++, Go, and Rust."
---

<!-- Shortcode calls must start at column 0: Hugo re-indents shortcode output
     to match call-site indentation, which corrupts pre/chroma content.
     scripts/check-website-links.mjs enforces this on the built HTML. -->

<div data-home-language-root data-active-language="typescript">

<section class="home-hero">
<div class="home-hero-copy">
  <p class="home-kicker">DSPy-style programming. RLM-powered agents. One compiled framework.</p>
  <h1><span class="home-h1-line">Build AI features</span> <span class="home-h1-line">and agents</span> <span class="home-h1-line">in your app.</span></h1>
  <p class="home-lede">Define the inputs and outputs. Improve results using examples and evaluations. Build agents that work through data and tools using code. One shared framework brings it all to <strong>TypeScript, Python, Java, C++, Go, and Rust.</strong></p>
  <div class="home-proof-row" aria-label="Ax highlights">
    <span><i class="home-proof-dot proof-blue" aria-hidden="true"></i>Open-source AI library</span>
    <span><i class="home-proof-dot proof-violet" aria-hidden="true"></i>Validated outputs</span>
    <span><i class="home-proof-dot proof-teal" aria-hidden="true"></i>Cloud and local models</span>
    <span><i class="home-proof-dot proof-green" aria-hidden="true"></i>Native in six languages</span>
  </div>
  <div class="home-actions">
    <a href="/typescript/quick-start/" data-home-lang-href="quick-start/">Build your first AI feature</a>
    <a class="home-button-secondary" href="https://github.com/ax-llm/ax">GitHub</a>
    <div class="home-hero-stats" data-home-stats data-repo="ax-llm/ax" data-npm-package="@ax-llm/ax" aria-label="Project stats">
      <a href="https://github.com/ax-llm/ax" hidden><strong data-stat="stars"></strong><span>GitHub stars</span></a>
      <a href="https://www.npmjs.com/package/@ax-llm/ax" hidden><strong data-stat="downloads"></strong><span>npm downloads/week</span></a>
    </div>
  </div>
  <p class="home-skills-note">Coding with AI? <a href="/typescript/skills/" data-home-lang-href="skills/">Install the Ax skills</a> — give Claude Code, Cursor, and other coding assistants the Ax API guide for your language.</p>
</div>
<div class="home-hero-panel" aria-label="Example AI task and result">
  <div class="home-example-tabs" role="tablist" aria-label="Hero example">
    <button type="button" role="tab" data-home-example-tab="classifier" aria-selected="true">Classify a review</button>
    <button type="button" role="tab" data-home-example-tab="agent" aria-selected="false">Analyze a ledger</button>
  </div>
{{< home-code topics="classifier,agent" group="hero" >}}
{{< home-output topics="classifier,agent" title="Example result" >}}
  <p class="home-inline-note">Abridged examples. <a href="/typescript/quick-start/" data-home-lang-href="quick-start/">Run your first complete program</a> or <a href="/typescript/agents/performance/" data-home-lang-href="agents/performance/">explore the ledger audit</a>.</p>
</div>
</section>

<div class="home-language-bar" data-home-language-bar aria-label="Choose your language">
  <span class="home-language-bar-label">Ax in your language</span>
{{< home-language-controls variant="hero" >}}
</div>

<div class="home-proof-strip" aria-label="Ax libraries and examples">
  <p><strong>One framework, native in six languages.</strong> Switch the language to see the same task in its native API. Runnable examples, documentation, and package checks are maintained together.</p>
</div>

<section class="home-section home-foundations" aria-labelledby="why-ax">
<div class="home-section-heading">
  <p class="home-section-label">Why Ax?</p>
  <h2 id="why-ax">Program it. Give it tools. Use it across your stack.</h2>
  <p>Ax combines three ideas that help you grow from a first AI feature to agents working with real data.</p>
</div>
<div class="home-card-grid three-up">
  <article class="home-marketing-card" data-home-foundation="dspy">
{{< home-icon "list-checks" "icon-violet" >}}
    <p class="home-card-eyebrow">DSPy-style programming</p>
    <h3>Program and improve your AI.</h3>
    <p>Define what a task receives and returns. Ax builds the prompt, validates the response, and lets you optimize instructions and examples against your evaluations — tests that score how well the task works.</p>
    <a class="home-card-link" href="/typescript/concepts/dspy/" data-home-lang-href="concepts/dspy/">How DSPy-style programming works</a>
  </article>
  <article class="home-marketing-card" data-home-foundation="rlm">
{{< home-icon "brain" "icon-teal" >}}
    <p class="home-card-eyebrow">RLM agents</p>
    <h3>Give agents data they can work with.</h3>
    <p>Following the Recursive Language Model approach, agents run small code steps to inspect data, calculate results, and use tools. Large inputs stay in the runtime; selected evidence enters the model's context.</p>
    <a class="home-card-link" href="/typescript/agents/" data-home-lang-href="agents/">See how RLM agents work</a>
  </article>
  <article class="home-marketing-card" data-home-foundation="compiled">
{{< home-icon "languages" "icon-blue" >}}
    <p class="home-card-eyebrow">One compiled framework</p>
    <h3>Learn once. Use it across your stack.</h3>
    <p>One shared core brings consistent concepts and checked behavior to TypeScript, Python, Java, C++, Go, and Rust. Native libraries fit each language, so teams can use Ax in the applications they already have.</p>
    <a class="home-card-link" href="#compiler-ir">How one framework becomes six libraries</a>
  </article>
</div>
</section>

<section class="home-section home-use-cases" aria-labelledby="included">
<div class="home-section-heading">
  <p class="home-section-label">What can you build?</p>
  <h2 id="included">Start with something useful.</h2>
  <p>Add one AI feature to your app, then combine it with tools and other steps as your needs grow.</p>
</div>
<div class="home-capability-grid">
  <article class="home-marketing-card" data-home-use-case="extraction">{{< home-icon "file-text" "icon-teal" >}}<h3>Turn documents into usable data</h3><p>Extract names, dates, and amounts from text into fields your application can use.</p><a class="home-card-link" href="/typescript/examples/generation/" data-home-lang-href="examples/generation/">Try structured extraction</a></article>
  <article class="home-marketing-card" data-home-use-case="classification">{{< home-icon "tags" "icon-violet" >}}<h3>Sort messages automatically</h3><p>Categorize incoming requests, customer feedback, or reviews using the labels you choose.</p><a class="home-card-link" href="/typescript/quick-start/" data-home-lang-href="quick-start/">Build a classifier</a></article>
  <article class="home-marketing-card" data-home-use-case="answers">{{< home-icon "message-circle" "icon-green" >}}<h3>Answer questions using your content</h3><p>Give the model relevant documents and a question to build an assistant for your own content.</p><a class="home-card-link" href="/typescript/examples/generation/" data-home-lang-href="examples/generation/">Explore question answering</a></article>
  <article class="home-marketing-card" data-home-use-case="agents">{{< home-icon "bot" "icon-blue" >}}<h3>Build assistants that use your tools</h3><p>Let an agent look up information, calculate results, and work through several steps to answer a request.</p><a class="home-card-link" href="/typescript/agents/micro/" data-home-lang-href="agents/micro/">Build your first agent</a></article>
  <article class="home-marketing-card home-audio-card" data-home-use-case="voice">{{< home-icon "activity" "icon-amber" >}}<h3>Add voice to your app</h3><p>Turn recordings into text, generate spoken responses, or add a voice conversation.</p><a class="home-card-link" href="/typescript/examples/#llm-media" data-home-lang-href="examples/#llm-media">Explore voice examples</a></article>
  <article class="home-marketing-card" data-home-use-case="workflows">{{< home-icon "list-checks" "icon-teal" >}}<h3>Automate a sequence of tasks</h3><p>Extract information, analyze it, and produce a report. Use workflows to connect steps, branches, and parallel work.</p><a class="home-card-link" href="/typescript/subsystems/flow/" data-home-lang-href="subsystems/flow/">Build a workflow</a></article>
</div>
</section>

<section id="graphjin" class="home-section home-graphjin" aria-labelledby="graphjin-title">
<div class="home-graphjin-header">
  <div class="home-graphjin-heading">
    <p class="home-section-label">AI for your databases</p>
    <h2 id="graphjin-title">Connect your databases to AI with GraphJin.</h2>
    <p>Ask questions across your databases in plain English. GraphJin connects the data and enforces configured access rules; its built-in agent uses Ax to investigate questions and assemble answers.</p>
  </div>
  <div class="home-actions home-graphjin-actions">
    <a href="https://graphjin.com/start/demos/">Try GraphJin with sample data</a>
    <a class="home-button-secondary" href="https://graphjin.com/agentic/server-agent/">How GraphJin uses Ax</a>
  </div>
</div>
<p class="home-inline-note">Already using Claude Code? These commands connect it to a GraphJin demo with sample data. Connecting your own databases requires a separate GraphJin configuration.</p>
<div class="home-graphjin-demo">
  <div class="home-graphjin-command-row" aria-label="GraphJin setup commands">
    <div class="home-graphjin-command" aria-label="Install GraphJin"><span>$</span><code><span class="home-install-command">npm install -g graphjin</span></code></div>
    <div class="home-graphjin-command" aria-label="Add GraphJin as an MCP server"><span>$</span><code><span class="home-install-command">claude mcp add graphjin -- graphjin mcp --demo</span></code></div>
  </div>
  <div class="home-graphjin-terminal" aria-label="GraphJin demo conversation">
    <div class="home-panel-title">Example question and answer</div>
<pre><code>Q: which customers churned last month,
   and what did they have in common?&#10;
A: 9 of 12 churned accounts were on the Starter plan.
   7 opened a support ticket in their final 30 days.
   Median tenure: 4 months.</code></pre>
  </div>
</div>
<div class="home-graphjin-status">
  <span aria-hidden="true"></span>
  <p>Queries checked against the schema · configured access rules enforced</p>
  <a href="https://github.com/dosco/graphjin">GraphJin source code</a>
</div>
<div class="home-graphjin-proof">
  <div class="home-graphjin-proof-heading">
    <p class="home-section-label">Proof, in public</p>
    <h3>DeepORG benchmark</h3>
    <a href="https://graphjin.com/benchmark/">Read the published results</a>
  </div>
  <p class="home-inline-note">GraphJin publishes task results, costs, and safety checks with the models and methodology used. Read the current report to see what was tested.</p>
</div>
</section>

<section class="home-section home-quick-install" aria-labelledby="quick-install">
<div class="home-section-heading">
  <p class="home-section-label">Get started</p>
  <h2 id="quick-install">Quick install</h2>
  <p>Pick your language and install its native library. The quick start walks you through setting a model API key and running your first program.</p>
</div>
<div class="home-quick-install-bar">
{{< home-language-controls >}}
</div>
{{< home-install >}}
<p class="home-inline-note"><a href="/typescript/quick-start/" data-home-lang-href="quick-start/">Set up your API key and run the first example</a>.</p>
<div class="home-agent-strip">
  <h3>Help your coding agent write Ax</h3>
  <p>Ax includes <strong>skills</strong>: instruction files that give Claude Code, Cursor, and other coding assistants the API guide and examples for your chosen language. Install them alongside Ax to help your assistant use the library.</p>
{{< home-install field="skillsCommand" class="home-install-skills" label="Install Ax agent skills" >}}
  <a class="home-agent-strip-link" href="/typescript/skills/" data-home-lang-href="skills/">Browse agent skills</a>
</div>
</section>

<section class="home-section home-code-story home-chapter-start" aria-labelledby="why-signatures">
<div class="home-section-heading">
  <p class="home-section-label">Your first AI call · DSPy</p>
  <h2 id="why-signatures">Describe the input and output. Ax handles the model call.</h2>
  <p>A signature is a short description of the inputs you provide and the outputs you want. In the review example, text goes in and a sentiment label comes back. This is the DSPy-style starting point: define the task, then test and improve how it performs.</p>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <h3>Get results your app can use.</h3>
    <p>Ax parses the response into fields, checks their types and constraints, and can retry with feedback when validation fails. These checks enforce the requested format; evaluate the answers too when correctness matters.</p>
    <div class="home-badge-row"><span>Validation</span><span>Streaming</span><span>Tools</span><span>Traces</span><span>Optimization</span></div>
  </div>
  <div>
{{< svg "semantic-network" "Signature contract network" >}}
  </div>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <p class="home-section-label">Signature pipeline</p>
    <h3>Ax handles the steps around the model call.</h3>
    <p>Your signature supplies the prompt fields and output checks. Ax calls the model, reads its response, and returns the declared fields. You can also stream results and inspect the steps when something goes wrong.</p>
  </div>
  <div>
{{< svg "signature-runtime" "Signature to runtime pipeline" >}}
  </div>
</div>
<div class="home-signature-grid">
  <article class="home-code-card">
    <div class="home-card-icon icon-violet" aria-hidden="true">S</div>
    <h3>Signature syntax</h3>
{{< home-code topic="signatureString" group="signature-string" compact="true" label="Signature syntax" >}}
    <p>Name the inputs and outputs in one line. Use arrays, dates, numbers, and other field types to describe the result you need.</p>
  </article>
  <article class="home-code-card">
    <div class="home-card-icon icon-teal" aria-hidden="true">F</div>
    <h3>Fields and constraints</h3>
{{< home-code topic="signatureFluent" group="signature-fluent" compact="true" label="Fields and constraints" >}}
    <p>Build a signature in code when you need rules such as a maximum summary length or a list of tags.</p>
  </article>
  <article class="home-code-card">
    <div class="home-card-icon icon-blue" aria-hidden="true">Z</div>
    <h3>Structured schema output</h3>
{{< home-code topic="signatureSchema" group="signature-schema" compact="true" label="Structured schema output" >}}
    <p>Use a supported schema builder to define the output shape and constraints, such as a score from one to ten.</p>
  </article>
</div>
</section>

<section class="home-section" aria-labelledby="declare-capabilities">
<div class="home-section-heading">
  <p class="home-section-label">Patterns</p>
  <h2 id="declare-capabilities">Small tasks start with a few fields.</h2>
  <p>These signature examples describe a task’s inputs and outputs. Run the program with a model and input values, as shown in the quick start. Choose your language to see the equivalent syntax.</p>
</div>
<div class="home-pattern-grid">
  <article>{{< home-icon "tags" "icon-violet" >}}<h3>Classification</h3><p>Categorize text into predefined classes.</p>
{{< home-code topic="patterns.classification" group="pattern-classification" compact="true" label="Classification" >}}
  </article>
  <article>{{< home-icon "file-text" "icon-teal" >}}<h3>Extraction</h3><p>Pull structured data from unstructured text.</p>
{{< home-code topic="patterns.extraction" group="pattern-extraction" compact="true" label="Extraction" >}}
  </article>
  <article>{{< home-icon "message-circle" "icon-green" >}}<h3>Question answering</h3><p>Answer questions with provided context.</p>
{{< home-code topic="patterns.qa" group="pattern-qa" compact="true" label="Question answering" >}}
  </article>
  <article>{{< home-icon "image" "icon-amber" >}}<h3>Ask about an image</h3><p>Provide a photo and a question about it.</p>
{{< home-code topic="patterns.multimodal" group="pattern-multimodal" compact="true" label="Image questions" >}}
  </article>
  <article>{{< home-icon "shield" "icon-rust" >}}<h3>Make a decision</h3><p>Ask the model for a yes-or-no result based on the inputs.</p>
{{< home-code topic="patterns.decision" group="pattern-decision" compact="true" label="Decision" >}}
  </article>
  <article>{{< home-icon "zap" "icon-blue" >}}<h3>Generate text</h3><p>Turn a topic into text. Use the streaming API to receive it incrementally.</p>
{{< home-code topic="patterns.generation" group="pattern-generation" compact="true" label="Text generation" >}}
  </article>
  <article>{{< home-icon "languages" "icon-violet" >}}<h3>Translation</h3><p>Translate text into the language you request.</p>
{{< home-code topic="patterns.translation" group="pattern-translation" compact="true" label="Translation" >}}
  </article>
  <article>{{< home-icon "list-checks" "icon-teal" >}}<h3>Summarize a document</h3><p>Return a summary and key points from one task.</p>
{{< home-code topic="patterns.summarization" group="pattern-summarization" compact="true" label="Summarization" >}}
  </article>
</div>
</section>

<section class="home-section home-agent-section home-chapter-start" aria-labelledby="agents-that-work">
<div class="home-section-heading home-agent-heading">
  <p class="home-section-label">Agents · RLM</p>
  <h2 id="agents-that-work">Build agents that work through data and tools.</h2>
  <p>An agent works through a task over several steps. Ax uses the RLM approach: the agent writes and runs code against data and tools, then uses the results to decide what to do next. Large inputs can stay in its runtime session, with selected evidence passed to the model.</p>
  <p>Try the <a href="https://github.com/ax-llm/ax/blob/main/src/examples/agent-grounded-audit.ts">grounded-audit example</a>: an agent audits a 250-row ledger and checks its totals and flagged transactions against an answer calculated in ordinary code. The published results describe this specific task and the models tested. <a href="/typescript/agents/performance/" data-home-lang-href="agents/performance/">See the measurements</a>.</p>
</div>
<div class="home-card-grid three-up home-agent-tier-grid">
  <article class="home-marketing-card home-agent-tier-card">{{< home-icon "zap" "icon-blue" >}}<h3>Answer using a few tools <span>Micro agents</span></h3><p>Start with a small task, the functions it needs, and the fields you want in the reply.</p><p><a href="/typescript/agents/micro/" data-home-lang-href="agents/micro/">Micro agents</a></p></article>
  <article class="home-marketing-card home-agent-tier-card">{{< home-icon "bot" "icon-teal" >}}<h3>Coordinate tools and specialists <span>Standard agents</span></h3><p>Let an agent find relevant tools, delegate work to specialist agents, and ask for clarification.</p><p><a href="/typescript/agents/standard/" data-home-lang-href="agents/standard/">Standard agents</a></p></article>
  <article class="home-marketing-card home-agent-tier-card">{{< home-icon "brain" "icon-green" >}}<h3>Work through larger tasks <span>Long-horizon agents</span></h3><p>Keep useful state, memory, and instructions available as an agent works through a longer job.</p><p><a href="/typescript/agents/long-horizon/" data-home-lang-href="agents/long-horizon/">Long-horizon agents</a></p></article>
</div>
<div class="home-agent-code">
{{< home-code topic="agent" group="agent" >}}
</div>
<div class="home-agent-layout">
  <div class="home-chart-panel">
{{< svg "rlm-loop" "RLM loop" >}}
  </div>
  <div class="home-agent-feature-grid">
    <article><h3>Find the right tools</h3><p>Discovery lets the agent load the tools it needs as it works, even when many are available.</p></article>
    <article><h3>Keep track of the task</h3><p>Context maps and summaries help the agent find relevant information without rereading the whole conversation.</p></article>
    <article><h3>Reuse useful knowledge</h3><p>Add memory for information worth recalling and skills for instructions the agent can use again.</p></article>
    <article><h3>Improve against your tests</h3><p>Use <code>agent.optimize(...)</code> with examples and scoring criteria to evaluate changes to agent behavior.</p></article>
  </div>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <p class="home-section-label">Function discovery</p>
    <h3>Connect tools and specialist agents as the job grows.</h3>
    <p>Group related tools and give specialist agents focused jobs. The main agent can discover those capabilities when it needs them.</p>
  </div>
  <div>
{{< svg "agent-tree" "Agent function discovery tree" >}}
  </div>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <p class="home-section-label">Context policy</p>
    <h3>Keep the work available between steps.</h3>
    <p>Store intermediate results in the runtime and use summaries to track progress. Context policies control how much of the conversation the model sees on later turns.</p>
  </div>
  <div>
{{< svg "context-growth" "Context growth chart" >}}
  </div>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <p class="home-section-label">MCP and tools</p>
    <h3>Connect your AI to tools and services.</h3>
    <p>Tools let your AI call functions in your application. MCP (Model Context Protocol) is a standard way to connect tools from other services. Ax can use both in a task or an agent.</p>
    <p><a href="/typescript/concepts/mcp/" data-home-lang-href="concepts/mcp/">Read the MCP guide</a> or <a href="/typescript/concepts/tools/" data-home-lang-href="concepts/tools/">open the tools guide</a>.</p>
  </div>
  <div>
{{< svg "mcp-bridge" "MCP bridge" >}}
  </div>
</div>
<div class="home-actions home-section-actions">
  <a href="/typescript/agents/" data-home-lang-href="agents/">Build an agent</a>
  <a class="home-button-secondary" href="/typescript/agents/performance/" data-home-lang-href="agents/performance/">Performance &amp; measurements</a>
  <a class="home-button-secondary" href="/typescript/concepts/optimization/" data-home-lang-href="concepts/optimization/">Optimization guide</a>
</div>
</section>

<section class="home-section home-audio-section" aria-labelledby="audio">
<div class="home-section-heading">
  <p class="home-section-label">Audio</p>
  <h2 id="audio">Build text, voice, and realtime AI apps.</h2>
  <p>Turn recordings into transcripts, generate spoken responses, or build a voice conversation. Choose a model and audio API that support the experience you need.</p>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <h3>Choose what your app needs to hear or say.</h3>
    <ul class="home-method-list">
      <li><code>ai.transcribe(...)</code> for batch speech-to-text.</li>
      <li><code>ai.speak(...)</code> for batch text-to-speech.</li>
      <li><code>speech:audio</code> for a program that returns generated speech alongside other fields.</li>
      <li><code>.chat()</code> audio config for conversational or realtime audio turns.</li>
      <li>Agents can transcribe audio inputs and work with the resulting text.</li>
    </ul>
    <p><a href="/typescript/concepts/llms/" data-home-lang-href="concepts/llms/">Read the LLM guide</a> or <a href="/typescript/examples/#llm-media" data-home-lang-href="examples/#llm-media">open media examples</a>.</p>
  </div>
  <div>
{{< home-code topic="audio" group="audio" >}}
  </div>
</div>
<div class="home-card-grid three-up">
  <article class="home-marketing-card">{{< home-icon "activity" "icon-blue" >}}<h3>Transcribe and speak</h3><p>Turn a recording into text or generate an audio file from a written response.</p></article>
  <article class="home-marketing-card">{{< home-icon "message-circle" "icon-teal" >}}<h3>Conversational audio</h3><p>Build a spoken conversation using a provider’s supported audio chat or realtime API.</p></article>
  <article class="home-marketing-card">{{< home-icon "brain" "icon-green" >}}<h3>Agent audio</h3><p>Give an agent a recording to work from and return a spoken response.</p></article>
</div>
</section>

<section class="home-section home-optimization-section" aria-labelledby="optimize-frontiers">
<div class="home-section-heading">
  <p class="home-section-label">Improve with evaluations · DSPy</p>
  <h2 id="optimize-frontiers">Improve your AI against examples of good results.</h2>
  <p>Give Ax example tasks and a way to score the results. Its optimizers test changes to instructions and examples so you can compare answer quality, speed, and cost. This is the next step in DSPy-style programming: improve the program against evaluations you control.</p>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <h3>Choose the results that fit your app.</h3>
    <p>GEPA searches for useful tradeoffs rather than one score alone. Compare the candidates, evaluate the one you choose on fresh tasks, and save its configuration for reuse. Optimization is an explicit training step; it does not happen automatically on every request.</p>
    <p><a href="/typescript/concepts/optimization/" data-home-lang-href="concepts/optimization/">Read optimization docs</a> or <a href="/typescript/api/optimize/" data-home-lang-href="api/optimize/">open the optimize API</a>.</p>
  </div>
  <div>
{{< svg "pareto-frontier" "GEPA Pareto frontier" >}}
  </div>
</div>
</section>

<section class="home-section home-model-section" aria-labelledby="use-any-model">
<div class="home-section-heading">
  <p class="home-section-label">LLM providers</p>
  <h2 id="use-any-model">Choose the model that fits your app.</h2>
  <p>Use OpenAI, Claude, Gemini, or a supported local model through <code>ai()</code>. Keep your task’s inputs and outputs while trying different models. Available features, such as voice, depend on the provider.</p>
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
    <p class="home-inline-note">Need routing, embeddings, audio, or context caching? <a href="/typescript/concepts/llms/" data-home-lang-href="concepts/llms/">Read the LLM guide</a>.</p>
  </div>
  <div class="home-provider-visual">
{{< svg "provider-router" "Provider router map" >}}
  </div>
</div>
</section>

<section class="home-section home-production-section" aria-labelledby="production-ready">
<div class="home-section-heading">
  <p class="home-section-label">Understand your app in production</p>
  <h2 id="production-ready">See what happened and what it cost.</h2>
  <p>Follow model calls and tool use, investigate errors, and track response times and estimated costs. Ax integrates with OpenTelemetry so you can inspect AI work alongside the rest of your application.</p>
</div>
<div class="home-stats" aria-label="Ax production highlights">
  <div><strong>1000+</strong><span>tests</span></div>
  <div><strong>40+</strong><span>OTel metrics</span></div>
  <div><strong>15+</strong><span>LLM providers</span></div>
  <div><strong>6</strong><span>languages</span></div>
</div>
<div class="home-card-grid production-grid">
  <article class="home-marketing-card">{{< home-icon "activity" "icon-blue" >}}<h3>Follow a request</h3><p>OpenTelemetry traces connect model calls, tool calls, and agent steps.</p></article>
  <article class="home-marketing-card">{{< home-icon "bar-chart" "icon-teal" >}}<h3>Spot slow or failing steps</h3><p>Track response times, token usage, and errors as your app runs.</p></article>
  <article class="home-marketing-card">{{< home-icon "zap" "icon-violet" >}}<h3>Show results as they arrive</h3><p>Stream output fields and check their format and constraints with validation and retry feedback.</p></article>
  <article class="home-marketing-card">{{< home-icon "dollar" "icon-green" >}}<h3>Track estimated costs</h3><p>See the estimated model cost of a request and compare it with answer quality.</p></article>
  <article class="home-marketing-card">{{< home-icon "globe" "icon-amber" >}}<h3>Work across your stack</h3><p>Use the shared Ax programming model from each of the six native libraries.</p></article>
  <article class="home-marketing-card">{{< home-icon "shield" "icon-rust" >}}<h3>Control how requests run</h3><p>Configure rate limits, provider routing, redaction, and error handling for your app.</p></article>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <p class="home-section-label">Operate Ax systems</p>
    <h3>Trace a result back to the steps that produced it.</h3>
    <p>Use the telemetry guide to connect Ax’s traces and metrics to your monitoring tools.</p>
    <p><a href="/typescript/concepts/telemetry/" data-home-lang-href="concepts/telemetry/">Read telemetry docs</a>.</p>
  </div>
  <div>
{{< svg "production-loop" "Production telemetry loop" >}}
  </div>
</div>
</section>

<section class="home-section home-compiler-section" aria-labelledby="compiler-ir">
<div class="home-section-heading">
  <p class="home-section-label">AxIR compiler</p>
  <h2 id="compiler-ir">One framework, compiled into native libraries.</h2>
  <p>TypeScript is the reference runtime. The AxIR compiler represents shared Ax behavior in a portable intermediate representation and emits native libraries for Python, Java, C++, Go, and Rust. Each library uses its language’s own names, errors, and builders, with shared checks for supported behavior.</p>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <p class="home-section-label">Compiler pipeline</p>
    <h3>Shared behavior. APIs that fit your language.</h3>
    <p>Use Ax in a Python service, a TypeScript app, or a Go backend while working with the same concepts. The compiler emits APIs shaped for each language from the shared core.</p>
  </div>
  <div>
{{< svg "axir-compiler" "AxIR compiler pipeline" >}}
  </div>
</div>
<div class="home-resource-row home-resource-row-tight">
  <div>
    <p class="home-section-label">Verified across languages</p>
    <h3>Language support comes with checks you can inspect.</h3>
    <p>The <code>axir verify</code> checks cover generated packages and their shared behavior. Runnable examples, documentation, and capability manifests show what each language supports, including differences in host runtimes and transports.</p>
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
  <h2 id="research">Built on DSPy, GEPA, ACE, RLM, and PEEK.</h2>
  <p>Explore the papers behind the programming model, optimization, and agents you have seen on this page. Each link connects a research idea to the part of Ax that puts it to work.</p>
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
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h3><a href="https://arxiv.org/abs/2510.04618">Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models</a></h3></div>
      <p class="paper-authors">Qizheng Zhang et al.</p>
      <p>Evolving context playbooks via generation, reflection, and curation map to Ax's ACE optimizer for agents and programs.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2510.04618">arXiv 2510.04618</a>
      <div class="paper-logo-row"><span class="paper-logo-mark paper-logo-stanford">Stanford</span></div>
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

<section class="home-section home-academy-cta" aria-labelledby="home-academy-title">
<article class="home-editorial-callout">
{{< home-icon "list-checks" "icon-violet" >}}
  <div class="home-editorial-callout-copy">
    <p class="home-section-label">Ax Academy</p>
    <h2 id="home-academy-title">Learn Ax step by step.</h2>
    <p>A free course in your browser, with short lessons, practice exercises, and review tailored to what you need next. Take it one lesson at a time; the full course is about six hours.</p>
  </div>
  <div class="home-actions home-editorial-callout-actions"><a href="/typescript/academy/" data-home-lang-href="academy/">Start Ax Academy</a></div>
</article>
</section>

<section class="home-section home-final-cta" aria-labelledby="get-started">
<div class="home-section-heading">
  <p class="home-section-label">Start now</p>
  <h2 id="get-started">Build your first AI feature today.</h2>
  <p>Choose your language, install Ax, and run a small task. Add tools, agents, and optimization when you need them.</p>
</div>
<div class="home-actions">
  <a href="/typescript/quick-start/" data-home-lang-href="quick-start/">Build your first AI feature</a>
  <a class="home-button-secondary" href="/typescript/how-ax-fits-together/" data-home-lang-href="how-ax-fits-together/">How Ax fits together</a>
  <a class="home-button-secondary" href="/typescript/examples/" data-home-lang-href="examples/">Examples</a>
  <a class="home-button-secondary" href="https://github.com/ax-llm/ax">GitHub</a>
</div>
<p class="home-inline-note">Built by <a href="https://x.com/intent/follow?screen_name=dosco">@dosco</a> — follow on X for new releases and to chat about Ax.</p>
<p class="home-inline-note">Building with an AI coding agent? <a href="/typescript/skills/" data-home-lang-href="skills/">Install the Ax skills</a> to give your assistant the API guide.</p>
</section>

</div>
