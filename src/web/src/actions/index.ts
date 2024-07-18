// cspell:ignore waku
'use server';

import { AxAI, AxAIOpenAIModel, AxGenerate } from '@ax-llm/ax';
import { v4 as uuidv4 } from 'uuid';
import { getEnv } from 'waku';

let counter = 0;

export async function incrementCount() {
  console.log('Count Incremented:', ++counter);
  return counter;
}

interface Message {
  content: string;
  id: string;
}

export async function sendMessage({
  content
}: Readonly<Message>): Promise<Message> {
  const ai = new AxAI({
    name: 'openai',
    apiKey: getEnv('OPENAI_APIKEY') ?? '',
    config: { model: AxAIOpenAIModel.GPT35Turbo }
  });
  const gen = new AxGenerate<{ userMessage: string }, { aiResponse: string }>(
    ai,
    `"you're a weird chatbot that says crazy things" userMessage -> aiResponse`
  );

  const { aiResponse } = await gen.forward({ userMessage: content });
  const aiResponseId = uuidv4();

  return { content: aiResponse, id: aiResponseId };
}
