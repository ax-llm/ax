import { atom, useAtom } from 'jotai';
import { useMemo } from 'react';

import { Message } from './types.js';

type EditorMessage = Partial<Omit<Message, 'chatId'>>;

export const messageEditorAtom = atom<Map<string, EditorMessage>>(new Map());

const createMessageEditorAtom = (chatId: string) =>
  atom(
    (get) => get(messageEditorAtom).get(chatId),
    (get, set, message: EditorMessage | undefined) => {
      const newMap = new Map(get(messageEditorAtom));
      if (message) {
        newMap.set(chatId, { ...message });
      } else {
        newMap.delete(chatId);
      }
      set(messageEditorAtom, newMap);
    }
  );

export const useMessageEditor = (chatId: string) => {
  const messagesAtom = useMemo(() => createMessageEditorAtom(chatId), [chatId]);
  return useAtom(messagesAtom);
};
