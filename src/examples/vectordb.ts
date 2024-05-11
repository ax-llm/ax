import { AI, DBManager, MemoryDB, OpenAIArgs } from '../index.js';

/* cSpell:disable */
const text = `The technological singularity—or simply the singularity[1]—is a hypothetical future point in time at which technological growth becomes uncontrollable and irreversible, resulting in unforeseeable consequences for human civilization.[2][3] According to the most popular version of the singularity hypothesis, I. J. Good's intelligence explosion model, an upgradable intelligent agent will eventually enter a positive feedback loop of self-improvement cycles, each new and more intelligent generation appearing more and more rapidly, causing a rapid increase ("explosion") in intelligence which ultimately results in a powerful superintelligence that qualitatively far surpasses all human intelligence.[4]

One of the most successful early gastromancers was Eurykles, a prophet at Athens; gastromancers came to be referred to as Euryklides in his honour.[3] Other parts of the world also have a tradition of ventriloquism for ritual or religious purposes; historically there have been adepts of this practice among the Zulu, Inuit, and Māori peoples.[3]
`;

// Instantiate services
const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);
const db = new MemoryDB();

const manager = new DBManager(ai, db);
await manager.insert(text);

const res = await manager.query(
  'John von Neumann on human intelligence and singularity.'
);
console.log(res);
