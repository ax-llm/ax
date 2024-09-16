import { GetChatRes, ListChatsRes } from '@/types/chats';
import useSWR from 'swr';

export const useChatList = () => {
  const { data, isLoading } = useSWR<ListChatsRes>(`/a/chats`);

  return {
    chats: data,
    isLoading
  };
};

export const useChatShow = (chatId?: string) => {
  const { data, isLoading } = useSWR<GetChatRes>(
    chatId ? `/a/chats/${chatId}` : null
  );

  return {
    chat: data,
    isLoading
  };
};
