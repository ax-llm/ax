import { atom, useAtom } from 'jotai';
import { useMemo } from 'react';

import { Message } from './types.js';

export const messageToEditAtom = atom<Map<string, Message>>(new Map());

const createMessageToEditAtom = (chatId: string) =>
  atom(
    (get) => get(messageToEditAtom).get(chatId),
    (get, set, message: Message | undefined) => {
      const newMap = new Map(get(messageToEditAtom));
      if (message) {
        newMap.set(chatId, { ...message, chatId });
      } else {
        newMap.delete(chatId);
      }
      set(messageToEditAtom, newMap);
    }
  );

export const useMessageToEdit = (chatId: string) => {
  const messagesAtom = useMemo(() => createMessageToEditAtom(chatId), [chatId]);
  return useAtom(messagesAtom);
};
