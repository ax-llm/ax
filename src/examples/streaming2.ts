import { AxAI, AxChainOfThought } from '@ax-llm/ax';

// const ai = new AxAI({
//     name: 'anthropic'
//     apiKey: process.env.ANTHROPIC_APIKEY as string
// });

// setup the prompt program
const gen = new AxChainOfThought<{ question: string }>(
  `question:string -> answerInPoints:string`
);

// add a assertion to ensure all lines start with a number and a dot.
gen.addStreamingAssert(
  'answerInPoints',
  (value: string, done?: boolean) => {
    const re = /^\d+\./;

    console.log('>>>', done, value);

    // split the value by lines, trim each line,
    // filter out very short lines and check if all lines match the regex
    return value
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => x.length > 4)
      .every((x) => re.test(x));
  },
  'Lines must start with a number and a dot. Eg: 1. This is a line.'
);

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
});

// run the program with streaming enabled
const res = await gen.forward(ai, {
  question: 'Provide a list of 3 optimizations to speedup LLM inference.'
});

console.log('>', res);
