import { AxAI, AxAIGoogleGeminiModel, ax } from '@ax-llm/ax';

// setup the prompt program
const gen = ax('startNumber:number -> next10Numbers:number[]');

// add assertions to ensure specific numbers are not in the output field
gen.addAssert(({ next10Numbers }: Readonly<{ next10Numbers: number[] }>) => {
  if (!next10Numbers) return undefined; // Skip if no numbers generated
  if (next10Numbers.includes(5)) {
    return `Number 5 found in results: [${next10Numbers.join(', ')}]. This number is not allowed.`;
  }
  return true;
});

gen.addAssert(({ next10Numbers }: Readonly<{ next10Numbers: number[] }>) => {
  if (!next10Numbers) return undefined; // Skip if no numbers generated
  if (next10Numbers.includes(2)) {
    return `Number 2 found in results: [${next10Numbers.join(', ')}]. This number is not allowed.`;
  }
  return true;
});

// const ai = new AxAI({
//   name: 'openai',
//   apiKey: process.env.OPENAI_APIKEY as string,
// })

const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: { model: AxAIGoogleGeminiModel.Gemini20FlashLite },
});
ai.setOptions({ debug: true });

// run the program with streaming enabled
const res = await gen.forward(ai, { startNumber: 1 });

console.log('>', res);
