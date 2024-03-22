import { AI, ChainOfThought, type OpenAIArgs } from '../index.js';

const text = `
The technological singularity—or simply the singularity[1]—is a hypothetical future point in time at which technological growth becomes uncontrollable and irreversible, resulting in unforeseeable changes to human civilization.[2][3] According to the most popular version of the singularity hypothesis, I.J. Good's intelligence explosion model, an upgradable intelligent agent will eventually enter a "runaway reaction" of self-improvement cycles, each new and more intelligent generation appearing more and more rapidly, causing an "explosion" in intelligence and resulting in a powerful superintelligence that qualitatively far surpasses all human intelligence.[4]
`;
// const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);
// const ai = AI('cohere', { apiKey: process.env.COHERE_APIKEY } as OpenAIArgs);
const ai = AI('anthropic', {
  apiKey: process.env.ANTHROPIC_APIKEY
} as OpenAIArgs);

const gen = new ChainOfThought(
  ai,
  `text -> shortSummary "summarize in 5 to 10 words"`
);
const res = await gen.forward({ text });

console.log('>', res);
