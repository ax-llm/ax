---
title: DSP Explained
description: Whats DSP and how to use it.
---

Demonstrate, search, predict or DSP is a now famous paper from Stanford focused on optimizing the prompting of LLMs. The basic idea being provide examples instead of instructions. 

Ax supports DSP and allows you to set examples on each prompt as well as run an optimizer which runs the prompt using inputs from a test set and validating the outputs against the same test set. In short the optimizer helps you capture good examples across the entire tree of prompts your workflow is build with.

## Pick a prompt strategy

There are various prompts available in Ax, pick one based on your needs.

1. **Generate** - Generic prompt that all other prompts inherit from.
2. **ReAct** - For reasoning and function calling, multi step function calling.
3. **ChainOfThough** - Increasing performance by reasoning before providing the answer
4. **RAG** - Uses a vector database to add context and improve performance and accuracy.


## Create a signature

A signature defines the task you want to do and the inputs you'll provide and the outputs you expect the LLM to generate

```typescript
const prompt = new Generate(ai, 
`"Summarize text" inputText:string -> pointByPointSummary:string[]`)
```