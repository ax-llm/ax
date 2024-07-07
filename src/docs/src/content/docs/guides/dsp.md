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
`"Extract customer query details" customerMessage:string -> customerName, customerIssue, ,productName:string, troubleshootingAttempted?:string`)
```

The next optional but most important thing you can do to improve performance of your prompts is to set examples. When we say "performance" we mean the number of times the llm doing exactly what you expect correctly over the number of times it fails.

Examples are the best way to communicate to the llm what you want it to do. The patterns you define in high quality examples help the llm much better than instructions.

```typescript
prompt.setExample([
    {
        customerMessage: "Hello, I'm Jane Smith. I'm having trouble with my UltraPhone X. The screen remains black even after restarting multiple times. I have tried charging it overnight and using a different charger.",
        customerName: "Jane Smith",
        productName: "UltraPhone X",
        troubleshootingAttempted: "Charging it overnight and using a different charger.",
    },
    {
        customerMessage: "Hi, my name is Michael Johnson. My EcoPrinter Pro isn't connecting to Wi-Fi. I've restarted the printer and my router, and also tried connecting via Ethernet cable.",
        customerName: "Michael Johnson",
        productName: "EcoPrinter Pro",
        troubleshootingAttempted: "Restarted the printer and router, and tried connecting via Ethernet cable.",
    },
    {
        customerMessage: "Greetings, I'm Sarah Lee. I'm experiencing issues with my SmartHome Hub. It keeps losing connection with my smart devices. I have reset the hub, checked my internet connection, and re-paired the devices.",
        customerName: "Sarah Lee",
        productName: "SmartHome Hub",
        troubleshootingAttempted: "Reset the hub, checked the internet connection, and re-paired the devices.",
    }
])
```

## Use this prompt

You are now ready to use this prompt in your workflows.

```typescript
# Setup the ai
const ai = new AxAI("openai", { apiKey: process.env.OPENAI_APIKEY })

# Execute the prompt
const { customerName, productName, troubleshootingAttempted } = prompt.forward({ customerMessage })
```

Easy enough! this is all you need

## DAP prompt tuning

What if I want more performance or I want to run this with a smaller model. I was old you can tune your prompts with DSP. Yes, this is true you can do this. In short you can using a big LLM to generate better examples for every prompt you use in your entire flow of prompts.


```typescript
// Use the HuggingFace data loader or create one for your own data
const hf = new AxHFDataLoader({
  dataset: 'yixuantt/MultiHopRAG',
  split: 'train',
  config: 'MultiHopRAG',
  options: { length: 5 }
});

await hf.loadData();
```

```typescript
// Fetch some rows, map the data columns to your prompts inputs
const examples = await hf.getRows<{ question: string; answer: string }>({
  count: 20,
  fields: ['query', 'answer'],
  renameMap: { query: 'question', answer: 'answer' }
});
```


```typescript
// Create your prompt
const prompt = new Generate(ai, `question -> answer`)
```

```typescript
// Setup a Bootstrap Few Shot optimizer to tune the above prompt
const optimize = new AxBootstrapFewShot<
  { question: string },
  { answer: string }
>({
  prompt,
  examples
});
```

```typescript
// Setup a evaluation metric em, f1 scores are a popular way measure retrieval performance.
const metricFn: AxMetricFn = ({ prediction, example }) => {
  return axEvalUtil.emScore(
    prediction.answer as string,
    example.answer as string
  );
};
```

```typescript
// Run the optimizer
const result = await optimize.compile(metricFn);

// Save the results to use later
await fs.promises.writeFile('./qna-tune-demos.json', values);
```

```typescript
// Use this tuning data in your workflow
const values = await fs.promises.readFile('./qna-tune-demos.json', 'utf8');
const demos = JSON.parse(values);

// Your done now, use this prompt
prompt.setDemos(demos);
```




