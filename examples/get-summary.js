import { Cohere, OpenAI, Memory, GenerateText, SummarizePrompt } from 'minds';

const ai = process.env.COHERE_APIKEY
  ? new Cohere(process.env.COHERE_APIKEY)
  : new OpenAI(process.env.OPENAI_APIKEY);

const mem = new Memory();
const prompt = new SummarizePrompt();
const gen = new GenerateText(ai, mem);
// gen.setDebug(true);

const query = `
The technological singularity—or simply the singularity[1]—is a hypothetical future point in time at which technological growth becomes uncontrollable and irreversible, resulting in unforeseeable changes to human civilization.[2][3] According to the most popular version of the singularity hypothesis, I.J. Good's intelligence explosion model, an upgradable intelligent agent will eventually enter a "runaway reaction" of self-improvement cycles, each new and more intelligent generation appearing more and more rapidly, causing an "explosion" in intelligence and resulting in a powerful superintelligence that qualitatively far surpasses all human intelligence.[4]
`;

const res = await gen.generate(query, prompt);
console.log('>', res.value);
