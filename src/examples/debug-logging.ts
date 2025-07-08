import { AxAI, AxChainOfThought, AxGen } from '@ax-llm/ax';

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
});

// 1. Basic debug logging (default colored output)
ai.setOptions({ debug: true });

const basicGen = new AxChainOfThought<
  { question: string },
  { answer: string; reasoning: string }
>(
  `question:string "A question to answer" -> 
   answer:string "The answer to the question",
   reasoning:string "Step by step reasoning"`
);

const basicResult = await basicGen.forward(ai, {
  question: 'What is the capital of Japan?',
});
console.log('Result:', basicResult);

// 2. Custom logger with timestamps
const timestampLogger = (message: string): void => {
  const timestamp = new Date().toISOString();
  process.stdout.write(`[${timestamp}] ${message}`);
};

const customGen = new AxGen<
  { textToClassify: string },
  { category: string; confidence: number }
>(
  `textToClassify:string "Text to classify" ->
   category:class "tech, business, sports, entertainment" "The category",
   confidence:number "Confidence score 0-1"`
);

const customResult = await customGen.forward(
  ai,
  { textToClassify: 'Apple announces new iPhone with AI features' },
  { logger: timestampLogger }
);
console.log('Result:', customResult);

// 3. Text-only logger (no colors)
const textLogger = (message: string): void => {
  process.stdout.write(message);
};

ai.setOptions({ debug: true, logger: textLogger });

const textGen = new AxChainOfThought<
  { problem: string },
  { solution: string; steps: string[] }
>(
  `problem:string "A problem to solve" ->
   solution:string "The solution",
   steps:string[] "List of solution steps"`
);

const textResult = await textGen.forward(ai, {
  problem: 'How to make a paper airplane?',
});
console.log('Result:', textResult);
