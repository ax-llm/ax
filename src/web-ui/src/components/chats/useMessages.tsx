import { ListChatMessagesRes } from '@/types/messages.js';
import { atom, useAtom, useAtomValue } from 'jotai';
import { useMemo } from 'react';
import useSWR from 'swr';

import { Messages } from './types.js';

const messagesMapAtom = atom<Map<string, Messages>>(new Map());

const createMessagesAtom = (chatId: string) =>
  atom(
    (get) => get(messagesMapAtom).get(chatId) ?? [],
    (get, set, messages: ListChatMessagesRes) => {
      const newMap = new Map(get(messagesMapAtom));
      newMap.set(chatId, messages);
      set(messagesMapAtom, newMap);
    }
  );

const useMessagesAtom = (chatId: string) => {
  return useMemo(() => createMessagesAtom(chatId), [chatId]);
};

export const useMessages = (chatId: string) => {
  return useAtom(useMessagesAtom(chatId));
};

export const useMessagesValue = (chatId: string) => {
  return useAtomValue(useMessagesAtom(chatId));
};

export const useMessagesById = (messageIds?: string[]) => {
  const enabled = messageIds && messageIds.length > 0;
  const { data: messages, isLoading } = useSWR<ListChatMessagesRes>(
    enabled ? `/a/messages?messageIds=${messageIds.join(',')}` : null
  );

  return {
    isLoading,
    messages: messages ?? []
  };
};
