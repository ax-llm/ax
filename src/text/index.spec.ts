import { JSONSchemaType } from 'ajv';
import test from 'ava';

import { Betty } from '../ai/betty.js';
import { codeInterpreterJavascript } from '../funcs/code.js';
import { AssistantPrompt } from '../prompts/chats.js';
import { BusinessInfo, ExtractInfoPrompt } from '../prompts/extract.js';
import { PromptFunction, SPrompt } from '../prompts/sprompt.js';

import { Memory } from './memory.js';

test('contextEnabledConversationWithAI', async (t) => {
  const humanQuerys = [
    'Hey there!',
    "I'm doing fine Just feel like chatting.",
    'Maybe about magic',
  ];

  const aiResponses = [
    'Hello! How can I help you today?',
    "That's great! What would you like to chat about?",
    'There is magic all around us.',
  ];

  const exp = humanQuerys
    .map((v, i) => `\nHuman: ${v}\nAI: ${aiResponses[i]}`)
    .map((_, i, a) => a.slice(0, i + 1));

  const ai = new Betty(aiResponses);
  const memory = new Memory();
  const prompt = new AssistantPrompt();

  for (let i = 0; i < humanQuerys.length; i++) {
    const q = humanQuerys[i];
    const res = await prompt.generate(ai, q, { memory });

    t.is(res.value(), aiResponses[i]);
    t.deepEqual(memory.peek(), exp[i]);
  }
});

test('multiSessionChatWithAI', async (t) => {
  const humanQuerys = [
    'Hey there!',
    "I'm doing fine Just feel like chatting.",
    'Maybe about magic',
  ];

  const aiResponses = [
    'Hello! How can I help you today?',
    "That's great! What would you like to chat about?",
    'There is magic all around us.',
  ];

  const exp = humanQuerys
    .map((v, i) => `\nHuman: ${v}\nAI: ${aiResponses[i]}`)
    .map((_, i, a) => a.slice(0, i + 1));

  const ai = new Betty(aiResponses);
  const memory = new Memory();
  const prompt = new AssistantPrompt();

  for (let i = 0; i < humanQuerys.length; i++) {
    const q = humanQuerys[i];
    const res1 = await prompt.generate(ai, q, { sessionId: '1', memory });
    const res2 = await prompt.generate(ai, q, { sessionId: '2', memory });
    const res3 = await prompt.generate(ai, q, { sessionId: '3', memory });

    t.is(res1.value(), aiResponses[i]);
    t.is(res2.value(), aiResponses[i]);
    t.is(res3.value(), aiResponses[i]);

    t.deepEqual(memory.peek('1'), exp[i]);
    t.deepEqual(memory.peek('2'), exp[i]);
    t.deepEqual(memory.peek('3'), exp[i]);
  }
});

const googleSearch = ({
  text,
}: Readonly<{ text: string }>): Promise<string> => {
  const value = `Question: ${text}\nAnserr:The largest company in Mountain View is unsurprisingly Google, founded way back in 1998. It has around 100,000 employees globally.`;
  return new Promise((res) => res(value));
};

test('findAnswersWithAI', async (t) => {
  const functions: PromptFunction[] = [
    {
      name: 'googleSearch',
      description:
        'useful for when you need to answer questions about current events',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            description: 'The text to search for',
            type: 'string',
            nullable: false,
          },
        },
        required: ['text'],
      },
      func: googleSearch as (args: unknown) => Promise<string>,
    },
  ];

  const resultSchema: JSONSchemaType<{ companyName: string }> = {
    type: 'object',
    properties: {
      companyName: {
        description: 'The name of the company',
        type: 'string',
      },
    },
    required: ['companyName'],
  };

  const interactions = [
    `Thought: Search for answer`,
    `Function Call: googleSearch({ text: "What are the biggest tech company in Mountain View, CA?" })`,
    `Observation: Google is the biggest company in Mountain View, CA.`,
    `Thought: I have the final answer.`,
    `Function Call: finalResult({ "companyName": "Google" })`,
  ];

  const ai = new Betty(interactions);
  const memory = new Memory();
  const prompt = new SPrompt<{ companyName: string }>(resultSchema, functions);
  // prompt.setDebug(true);

  const res = await prompt.generate(
    ai,
    'What are the biggest tech company in Mountain View, CA?',
    { memory }
  );

  const answer = res.value() as { companyName: string };
  t.is(answer.companyName, 'Google');
});

test('extractInfoWithAI', async (t) => {
  const entities = [
    { name: BusinessInfo.ProductName },
    { name: BusinessInfo.Priority, classes: ['High', 'Medium', 'Low'] },
  ];

  const interactions = [
    'Product Name: XYZ Smartwatch\nPriority: \nMedium\nRandom: N/A',
  ];

  const ai = new Betty(interactions);
  const prompt = new ExtractInfoPrompt(entities);
  // prompt.setDebug(true);

  const res = await prompt.generate(
    ai,
    'I am writing to report an issue with my recent order #12345. I received the package yesterday, but unfortunately, the product that I paid for with cash (XYZ Smartwatch) is not functioning properly.'
  );

  const exp = new Map([
    ['Product Name', ['XYZ Smartwatch']],
    ['Priority', ['Medium']],
  ]);

  const got = <Map<string, string[]>>res.value();

  t.is(exp.size, got.size);

  for (const [key, value] of exp) {
    t.true(got.has(key));
    t.deepEqual(value, got.get(key));
  }
});

test('getStructuredDataFromAI', async (t) => {
  const interactions = [
    `{
    "name": "Sneakers",
    "pitch": "A team of security experts and hackers led by Martin Bishop is blackmailed by government agents into stealing a valuable, top-secret decoding device.",
    "genre": "Comedy, Crime, Drama",
    "actors": [
      {
        "name": "Robert Redford",
        "role": "Martin Bishop"
      },
      {
        "name": "Sidney Poitier",
        "role": "Donald Crease"
      },
      {
        "name": "Dan Aykroyd",
        "role": "Mother"
      }
    ],
    "budgetInUSD": 35000000,
    "success": true
  }`,
  ];

  interface Oracle {
    name: string;
    pitch: string;
    genre: string;
    actors: { name: string; role: string }[];
    budgetInUSD: number;
    success: boolean;
  }

  const oracle: JSONSchemaType<Oracle> = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      pitch: { type: 'string' },
      genre: { type: 'string' },
      actors: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, role: { type: 'string' } },
          required: ['name', 'role'],
        },
      },
      budgetInUSD: { type: 'number' },
      success: { type: 'boolean' },
    },
    required: ['name', 'pitch', 'genre', 'actors', 'budgetInUSD', 'success'],
    additionalProperties: false,
  };

  const ai = new Betty(interactions);
  const prompt = new SPrompt<Oracle>(oracle);
  prompt.setDebug(true);

  const res = await prompt.generate(
    ai,
    'Give me details on the movie Sneakers'
  );

  const movie = res.value() as Oracle;
  t.is(movie.name, 'Sneakers');
  t.is(movie.budgetInUSD, 35000000);
  t.is(movie.actors[0].role, 'Martin Bishop');
});

test('codeInterpreterJavascript', async (t) => {
  const code = `
    const a = 1;
    const b = 41;
    return a + b;`;

  const ret = codeInterpreterJavascript(code);
  t.is(ret, 42);
});
