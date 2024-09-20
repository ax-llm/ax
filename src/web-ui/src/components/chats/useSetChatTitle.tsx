import { postFetch } from '@/lib/fetchers';
import { useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';

export const useSetChatTitle = (chatId: string) => {
  const { mutate } = useSWRConfig();

  const { isMutating: isMutating, trigger: updateTitle } = useSWRMutation(
    `/a/chats/${chatId}/title`,
    postFetch
  );

  const updateTitleHandler = async () => {
    await updateTitle();
    mutate(`/a/chats/${chatId}`);
  };

  return {
    chatId,
    isUpdatingTitle: isMutating,
    updateTitle: updateTitleHandler
  };
};
