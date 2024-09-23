import type {
  AxAIMemory,
  AxChatRequest,
  AxChatResponseResult,
  AxWritableChatPrompt
} from '@ax-llm/ax';
import type { Db, ObjectId } from 'mongodb';

import type { Message } from './types.js';

type ChatPrompt = AxChatRequest['chatPrompt'];

export class ChatMemory implements AxAIMemory {
  private chatCurrent: AxWritableChatPrompt = [];
  private chatHistory: ChatPrompt = [];

  getCurrentChat = (): ChatPrompt => this.chatCurrent;

  constructor(chatHistory: ChatPrompt) {
    this.chatHistory = chatHistory;
    this.chatCurrent = [];
  }

  add(value: Readonly<ChatPrompt | ChatPrompt[0]>): void {
    if (Array.isArray(value)) {
      this.chatCurrent = [...this.chatCurrent, ...value];
    } else {
      this.chatCurrent = [...this.chatCurrent, value] as ChatPrompt;
    }
  }

  addResult({
    content,
    functionCalls,
    name
  }: Readonly<AxChatResponseResult>): void {
    if (!content && (!functionCalls || functionCalls.length === 0)) {
      return;
    }
    this.add({ content, functionCalls, name, role: 'assistant' });
  }

  getLast(): ChatPrompt[0] | undefined {
    return this.chatCurrent.at(-1);
  }

  history(): ChatPrompt {
    return [...this.chatHistory, ...this.chatCurrent];
  }

  reset() {
    this.chatCurrent = [];
  }

  updateResult({
    content,
    functionCalls,
    name
  }: Readonly<AxChatResponseResult>): void {
    const items = this.chatCurrent;
    const lastItem = items.at(-1);

    if (!lastItem || lastItem.role !== 'assistant') {
      this.addResult({ content, functionCalls, name });
      return;
    }

    if ('content' in lastItem && content) {
      lastItem.content = content;
    }
    if ('name' in lastItem && name) {
      lastItem.name = name;
    }
    if ('functionCalls' in lastItem && functionCalls) {
      lastItem.functionCalls = functionCalls;
    }
  }
}

interface GetMessageHistoryArgs {
  chatId: ObjectId;
  parentMessageId?: ObjectId;
}

interface GetMessageHistoryReturn {
  history: string;
  images?: { data: string; mimeType: string }[];
  parent: { context?: string; images?: string[]; text: string };
}

export const getMessageHistory = async (
  db: Db,
  { chatId, parentMessageId }: GetMessageHistoryArgs
): Promise<GetMessageHistoryReturn> => {
  const allMessages = await db
    .collection<Message>('messages')
    .find({ chatId, error: { $exists: false } })
    .toArray();

  const messages = parentMessageId
    ? allMessages.slice(
        0,
        allMessages.findIndex((m) => m._id.equals(parentMessageId))
      )
    : allMessages;

  const parentMessage = allMessages.find((m) => m._id.equals(parentMessageId));
  if (!parentMessage) {
    throw new Error('Parent message not found');
  }
  if (!parentMessage.text) {
    throw new Error('Parent message has no text');
  }

  const buildMsg = (m: Message) => {
    const text = m.agentId ? `Agent: ${m.text}` : `User: ${m.text}`;

    let context: string | undefined;
    if (m.files) {
      const docs = m.files
        .filter((f) => f.type.startsWith('image') === false)
        .map((f) => f.file)
        .join(', ');
      context = `Context: ${docs}`;
    }
    return { context, text };
  };

  const parent = buildMsg(parentMessage);

  const history: string = messages
    .filter((m) => m.text && !m.error)
    .map(buildMsg)
    .map((m) => [m.text, m.context].filter(Boolean).join('\n'))
    .join('\n');

  const images = [...messages, parentMessage]
    .filter((m) => m.files?.some((f) => f.type.startsWith('image')))
    .flatMap((m) => m.files ?? [])
    .map((f) => ({ data: f.file, mimeType: f.type }));

  console.log('images', images);
  console.log('parent', parent);
  console.log('history', history);

  return { history, images, parent };
};
