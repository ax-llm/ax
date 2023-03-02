import test from 'ava';

import { Embeddings, GenerateText, Memory } from '.';

import { Betty } from '../ai';
import {
  AssistantPrompt,
  QuestionAnswerPrompt,
  ExtractInfoPrompt,
  BusinessInfo,
} from '../prompts';

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
  const mem = new Memory();
  const prompt = new AssistantPrompt();
  const gen = new GenerateText(ai, mem);

  for (let i = 0; i < humanQuerys.length; i++) {
    const q = humanQuerys[i];
    const res = await gen.generate(q, prompt);

    t.is(res.values[0].text, aiResponses[i]);
    t.deepEqual(mem.peek(), exp[i]);
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
  const mem = new Memory();
  const prompt = new AssistantPrompt();
  const gen = new GenerateText(ai, mem);

  for (let i = 0; i < humanQuerys.length; i++) {
    const q = humanQuerys[i];
    const res1 = await gen.generate(q, prompt, '1');
    const res2 = await gen.generate(q, prompt, '2');
    const res3 = await gen.generate(q, prompt, '3');

    t.is(res1.values[0].text, aiResponses[i]);
    t.is(res2.values[0].text, aiResponses[i]);
    t.is(res3.values[0].text, aiResponses[i]);

    t.deepEqual(mem.peek('1'), exp[i]);
    t.deepEqual(mem.peek('2'), exp[i]);
    t.deepEqual(mem.peek('3'), exp[i]);
  }
});

test('findAnswersWithAI', async (t) => {
  const actions = [
    {
      name: 'Google Search',
      description:
        'useful for when you need to answer questions about current events',
      action: googleSearch,
    },
  ];

  const interactions = [
    'I should look up who the biggest tech company in in Mountain View, CA\nAction: Google Search\nAction Input: "biggest tech company in Mountain View"',
    `\nObservation: ${googleSearch('"biggest tech company in Mountain View"')}`,
    'I now know who the biggest tech company in Mountain View\nFinal Answer: Google',
  ];

  const aiResponses = interactions.filter(
    (v) => !v.startsWith('\nObservation:')
  );

  const exp = interactions
    .map((v) => (v.startsWith('\nObservation:') ? v : `\nThought: ${v}`))
    .map((_, i, a) => a.slice(0, i + 1));

  const ai = new Betty(aiResponses);
  const mem = new Memory();
  const prompt = new QuestionAnswerPrompt(actions);
  const gen = new GenerateText(ai, mem);
  // gen.setDebug(true);

  const res = await gen.generate(
    'What are the biggest tech company in Mountain View, CA?',
    prompt
  );
  t.is(res.values[0].text, 'Google');
  t.deepEqual(mem.peek().join(''), exp.pop().join(''));
});

const googleSearch = (text: string): string => {
  if (text === `"biggest tech company in Mountain View"`) {
    return `The largest company in Mountain View is unsurprisingly Google, founded way back in 1998. It has around 100,000 employees globally.`;
  }
  return '';
};

test('usingEmbeddingsFindAnswersWithAI', async (t) => {
  const actions = [
    {
      name: 'Science Search',
      description: 'useful for when you need to answers to science questions',
      action: scienceSearch,
    },
  ];

  const finalAnswer =
    'Pluto is the coldest planet since its the last planet in our solar system';

  const interactions = [
    'I should look up some information about the plabet Mars, CA\nAction: Science Search\nAction Input: "Coldest planet in our solar system"',
    `\nObservation: Pluto is the last planet in our solar system`,
    `I now know who the coldest planet\nFinal Answer: ${finalAnswer}`,
  ];

  const aiResponses = interactions.filter(
    (v) => !v.startsWith('\nObservation:')
  );

  const exp = interactions
    .map((v) => (v.startsWith('\nObservation:') ? v : `\nThought: ${v}`))
    .map((_, i, a) => a.slice(0, i + 1));

  const ai = new Betty(aiResponses);
  const mem = new Memory();
  const prompt = new QuestionAnswerPrompt(actions);
  const gen = new GenerateText(ai, mem);
  // gen.setDebug(true);

  const res = await gen.generate(
    'What is the coldest planet in our galexy?',
    prompt
  );
  t.is(res.values[0].text, finalAnswer);
  t.deepEqual(mem.peek().join(''), exp.pop().join(''));
});

const scienceSearch = (_text: string, embed: Embeddings): string => {
  if (embed.embeddings.length === 0) {
    throw new Error('No embeddings returned');
  }
  return 'Pluto is the last planet in our solar system';
};

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
  const gen = new GenerateText(ai);
  // gen.setDebug(true);

  const res = await gen.generate(
    'I am writing to report an issue with my recent order #12345. I received the package yesterday, but unfortunately, the product that I paid for with cash (XYZ Smartwatch) is not functioning properly.',
    prompt
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
