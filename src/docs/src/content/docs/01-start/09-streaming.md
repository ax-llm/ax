---
title: Streaming Outputs
description: Learn how to use streaming outputs in ax, including streaming validation and assertions for the output fields and function execution.
---

We support parsing output fields and function execution while streaming. And end-to-end streaming with parsing, validating and function calling while streaming. This allows for fail-fast and error correction without waiting for the whole output, saving tokens and costs and reducing latency. Assertions are a powerful way to ensure the output matches your requirements; they also work with streaming.

```typescript
// setup the prompt program
const gen = new AxChainOfThought(
  ai,
  `startNumber:number -> next10Numbers:number[]`
);

// add a assertion to ensure that the number 5 is not in an output field
gen.addAssert(({ next10Numbers }: Readonly<{ next10Numbers: number[] }>) => {
  return next10Numbers ? !next10Numbers.includes(5) : undefined;
}, 'Numbers 5 is not allowed');

// run the program with streaming enabled
const res = await gen.forward({ startNumber: 1 }, { stream: true });

// or run the program with end-to-end streaming
const generator = await gen.streamingForward({ startNumber: 1 }, { stream: true });
for await (const res of generator) {}
```

The above example allows you to validate entire output fields as they are streamed in. This validation works with streaming and when not streaming and is triggered when the whole field value is available. For true validation while streaming, check out the example below. This will massively improve performance and save tokens at scale in production.

```typescript
// add a assertion to ensure all lines start with a number and a dot.
gen.addStreamingAssert(
  'answerInPoints',
  (value: string) => {
    const re = /^\d+\./;

    // split the value by lines, trim each line,
    // filter out empty lines and check if all lines match the regex
    return value
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .every((x) => re.test(x));
  },
  'Lines must start with a number and a dot. Eg: 1. This is a line.'
);

// run the program with streaming enabled
const res = await gen.forward(
  {
    question: 'Provide a list of optimizations to speedup LLM inference.'
  },
  { stream: true, debug: true }
);
```