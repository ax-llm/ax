# FAQ

Plain-English answers for getting from a first typed call to agents, optimization, and the research terms used across Ax.

## Getting Started

### What is Ax in one sentence?

Ax is a native {{language}} library for declaring typed LLM programs that validate, retry, stream, compose, and improve across model providers.

### Do I need to know DSPy first?

No. Start with a signature and `ax()`; the [DSPy concepts page]({{langRoot}}/concepts/dspy/) explains the research lineage when you want the deeper mental model.

### Which API key do I need?

Use a key from any provider Ax supports. The Quick Start uses OpenAI because it is a familiar default, but the program contract is provider-independent. See [LLMs and providers]({{langRoot}}/concepts/llms/).

### What does it cost to try?

Ax itself is Apache-2.0 open source. Your only required runtime cost is whatever model provider you choose to call; a small model and a short classification request are enough for the Quick Start.

### Is Ax really native in {{language}}?

Yes. This site is generated for each language from one compiler-owned semantic core, while {{packageName}} exposes native naming, errors, builders, transports, and runtime boundaries. It is not a TypeScript program running behind a wrapper.

## Signatures And Typed Calls

### What exactly is a signature?

A signature is a compact contract that names the input fields a model receives and the typed output fields your code expects. Ax uses it to build prompts, schemas, validators, retry feedback, traces, and host-language output types.

### Why not just call the OpenAI SDK myself?

You can when a raw provider call is all you need. As soon as the app adds a prompt string, JSON or regex scraping, schema checks, correction retries, streaming state, traces, evals, and a second provider, that glue becomes the real system. Ax attaches it to one typed contract so the application keeps a stable boundary.

### What happens when the model returns garbage?

Ax parses and validates the declared fields. If output is missing, malformed, or violates a constraint, the retry loop sends the concrete validation error back as feedback instead of silently handing bad data to your code.

### Can I stream results?

Yes. Structured fields are parsed as model output arrives, so callers can consume partial typed deltas while the final result still passes the same validation contract. See the [`ax()` subsystem]({{langRoot}}/subsystems/ax/).

## Agents

### When do I need agent() instead of ax()?

Use `ax()` when one typed model call can answer. Use `agent()` when the job needs tools, several decisions, large data kept outside the prompt, clarification, memory, or a persistent runtime session.

### What is the runtime session in plain English?

It is a scratch computer next to the model. Your data sits in that session, and the model writes small code steps that inspect or transform it instead of trying to read everything in one prompt.

### Why do my rows never enter the prompt?

Context fields and host-owned tools keep bulky values in the runtime. The model receives the schema, a compact descriptor, and the exact evidence returned by the code steps it chose—not the raw table.

### Can an agent call my existing functions or a database?

Yes. Functions become typed tools, MCP servers become discoverable external tools, and runtimes can register host callables in-process. [GraphJin](https://graphjin.com) is the shipped production example: it embeds the Ax Go agent beside its query engine so model-written steps operate on data the host owns.

## Improving Quality

### What does optimization mean here?

`{{optimizeName}}` runs a program, scores its outputs, reflects on failures, and evolves instructions or demonstrations. It improves the existing typed program rather than training a new foundation model.

### Do I need training data?

You need a small set of representative examples and a metric that can tell better from worse. A handful of good cases is enough to begin; add edge cases as traces reveal where the program fails.

## Jargon Translated

| Term | Plain-English meaning |
| --- | --- |
| DSPy | A way to program model behavior with declarative modules and measurable examples instead of hand-tuning prompt strings. |
| GEPA | A Genetic-Pareto optimizer that runs a program, reflects on failures, evolves instructions, and keeps the useful tradeoffs. |
| ACE | A curated playbook grown from a program's own runs and feedback, then reused as evolving context. |
| RLM | A model computing on big data through small code steps in a runtime instead of reading all of it in the prompt. |
| PEEK | A persistent orientation cache for a large corpus that an agent revisits over time. |
| AxIR | The compiler core that emits the native Python, Java, C++, Go, and Rust packages from shared Ax semantics. |
| MCP | Model Context Protocol, a standard way for applications to expose tools, resources, prompts, and long-running tasks. |
| signature | The typed input and output contract that Ax turns into prompts, schemas, validation, retries, and program interfaces. |

## Where To Go Next

- [Run the Quick Start]({{langRoot}}/quick-start/)
- [See how Ax fits together]({{langRoot}}/how-ax-fits-together/)
- [Browse runnable examples]({{langRoot}}/examples/)
- [Read the research map](/research/)
