---
title: About Ax
description: The best framework to build LLM powered agents
---

We're building the ultimate typescript framework for building agents and other complex LLM powered workflows.

## Motivation and vision

In the start there was the LLM a raw and powerful technology that had endless potential but was hard to work with within your own software. Our first goal was to abstract out the LLM and have sensible defaults so you can build with any LLM while still using features like multi-modal, streaming, function calling, etc.

Next we wanted to abstract out the prompting layer, we wanted it to be as fluid and flexible as writing code. We wanted automatic type enforcement, extensibility, composability, reuse and a lot more. We wanted prompting to be like coding. Our search brought us to the Stanford DSP series of papers. by Omar Khattab, et. all. The core of the paper was around how prompts can be programs, tunable by LLMs to become more efficient. This was fascinating stuff and we adopted several of these break throughs in our framework such as prompt signatures, prompt tuning, assertions, etc.

Finally we were ready to start building on this solid foundation all the workflows we wanted. Our first focus was RAG and the Agents both of which fully leverage the framework features like DSP, streaming, mulit-modal, llm independence, etc.

We are now excited build more useful layers on top of what we already built, Agent collaboration and Human agent collaboration. It is our strong belief that our current generation of LLMs are extremely, extremely powerful and we can build fantastic things given the right framework and abstractions to work with. Agentic workflows are the future of building with LLMs and Ax is the best framework towards that goal.

> "I expect that the set of tasks AI can do will expand dramatically this year because of agentic workflows…”
>
> Andrew Ng, Cofounder and head of Google Brain, former Chief Scientist at Baidu

## Reach out

https://twitter.com/dosco

## Features

- Full support for all top LLMs
- Multi-modal, function calling, streaming
- DSP styled typed prompt signatures
- Build agents that can use other agents
- Automatic RAG, smart chunking, embedding, querying
- Convert docs of any format to text
- Output fields parsed and validated while streaming
- Multi-modal DSP supported, use images with text fields
- Automatic prompt tuning using optimizers
- OpenTelemetry tracing / observability
- Production ready Typescript code
- Vertically integrated all parts work well together
- Lite weight, zero-dependencies
