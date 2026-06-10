# Quick Start

Ax gives {{language}} one typed contract for LLM programs: signatures for data shape, `ai()` for model access, `ax()` for structured generation, `agent()` for tool-using runtime loops, and {{optimizeName}} for improving programs with examples.

## Install

```{{shellFence}}
{{install}}
```

## First Program

Start with a small typed task. The signature declares the fields the model receives and the fields Ax must parse back out.

```{{fence}}
{{quickStartCode}}
```

That is the core loop:

- create a provider client
- declare the input and output contract
- run the program with typed inputs
- read typed outputs instead of scraping prose

The rest of the site keeps the same concepts but swaps install commands, imports, examples, and API names for {{language}}.

## Where To Go Next

Use [Examples]({{langRoot}}/examples/) when you want runnable files. Use [Concepts]({{langRoot}}/concepts/dspy/) when you want the mental model. Use [Subsystems]({{langRoot}}/subsystems/ax/) when you know which surface you are trying to use and want the practical call shape.

## What To Read Next

- [Examples]({{langRoot}}/examples/)
- [DSPy concepts]({{langRoot}}/concepts/dspy/)
- [ai() LLM models]({{langRoot}}/subsystems/ai/)
- [ax() generation]({{langRoot}}/subsystems/ax/)
- [{{optimizeName}} GEPA]({{langRoot}}/subsystems/optimize/)
