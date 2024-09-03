import type { ListChatMessagesRes } from './messages.js';

export type StreamMsgIn = {
  chatId: string;
  msgType: 'registerChatClient';
};

export type StreamMsgOut =
  | { msgType: 'clientRegistered' }
  | ({ msgType: 'updateChatMessage' } & ListChatMessagesRes[0]);
