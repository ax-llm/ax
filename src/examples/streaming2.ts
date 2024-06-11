import { AI, ChainOfThought, type OpenAIArgs } from '../index.js';

// const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);
const ai = AI('google-gemini', {
  apiKey: process.env.GOOGLE_APIKEY
} as OpenAIArgs);

// setup the prompt program
const gen = new ChainOfThought(ai, `question:string -> answerInPoints:string`);

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

console.log('>', res);
