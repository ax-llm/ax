import { ListChatMessagesRes } from '@/types/messages.js';
import { atom, useAtom, useAtomValue } from 'jotai';
import { useMemo } from 'react';

import { Messages } from './types.js';

const messagesMapAtom = atom<Map<string, Messages>>(new Map());

const createMessagesAtom = (chatId: string) =>
  atom(
    (get) => get(messagesMapAtom).get(chatId) ?? [],
    (get, set, messages: ListChatMessagesRes) => {
      const newMap = new Map(get(messagesMapAtom));
      const msgs = messages.map((msg) => ({ ...msg, chatId }));
      newMap.set(chatId, msgs);
      set(messagesMapAtom, newMap);
    }
  );

export const useMessages = (chatId: string) => {
  const messagesAtom = useMemo(() => createMessagesAtom(chatId), [chatId]);
  return useAtom(messagesAtom);
};

export const useMessagesValue = (chatId: string) => {
  const messagesAtom = useMemo(() => createMessagesAtom(chatId), [chatId]);
  return useAtomValue(messagesAtom);
};
