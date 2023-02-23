import test from 'ava';

import { Betty } from '../ai/betty';
import { Memory } from './memory';
import { GenerateText } from '.';
import { AssistantPrompt } from '../prompts/chats';
import { QuestionAnswerPrompt } from '../prompts/answers';

test('chatWithAI', async (t) => {
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
    .map((v, i) => `\nHuman: ${v}\nAssistant: ${aiResponses[i]}`)
    .map((_, i, a) => a.slice(0, i + 1));

  const ai = new Betty(aiResponses);
  const mem = new Memory();
  const prompt = new AssistantPrompt();
  const gen = new GenerateText(ai, mem);

  for (let i = 0; i < humanQuerys.length; i++) {
    const q = humanQuerys[i];
    const res = await gen.generate(q, prompt);

    t.is(res.value, aiResponses[i]);
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
    .map((v, i) => `\nHuman: ${v}\nAssistant: ${aiResponses[i]}`)
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

    t.is(res1.value, aiResponses[i]);
    t.is(res2.value, aiResponses[i]);
    t.is(res3.value, aiResponses[i]);

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
      action: searchAction,
    },
  ];

  const interactions = [
    'I should look up who the biggest tech company in in Mountain View, CA\nAction Name: Google Search\nAction Input: "biggest tech company in Mountain View"',
    `\nObservation: ${searchAction('"biggest tech company in Mountain View"')}`,
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
  t.is(res.value, 'Google');
  t.deepEqual(mem.peek().join(''), exp.pop().join(''));
});

const searchAction = (text: string): string => {
  if (text === `"biggest tech company in Mountain View"`) {
    return `The largest company in Mountain View is unsurprisingly Google, founded way back in 1998. It has around 100,000 employees globally.`;
  }
  return '';
};
