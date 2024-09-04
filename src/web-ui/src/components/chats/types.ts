import { ListChatMessagesRes } from '@/types/messages';

export type Message = { chatId: string } & ListChatMessagesRes[0];

export type Messages = Message[];
