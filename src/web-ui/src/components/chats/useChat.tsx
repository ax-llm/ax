import { postFetch } from '@/lib/fetchers';
import { CreateChatReq, createChatReq } from '@/types/chats.js';
import {
  CreateUpdateChatMessageReq,
  ListChatMessagesRes,
  createUpdateChatMessageReq
} from '@/types/messages';
import { StreamMsgIn, StreamMsgOut } from '@/types/stream';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import useSWR from 'swr';
import useSWRMutation, { SWRMutationConfiguration } from 'swr/mutation';

import { useMessageToEdit } from './useMessageToEdit.js';
import { useMessages } from './useMessages.js';

type RegisterChatClient = Extract<
  StreamMsgIn,
  { msgType: 'registerChatClient' }
>;

type UpdateChatMessage = Extract<
  StreamMsgOut,
  { msgType: 'updateChatMessage' }
>;

const setMessageResponse = (
  { msgType, ...res }: UpdateChatMessage,
  messages: ListChatMessagesRes
) => {
  if (res.updatedAt) {
    const updatedMsgCreatedAt = new Date(res.createdAt);

    const filteredMsgs = messages.filter(
      (msg) => new Date(msg.createdAt) < updatedMsgCreatedAt
    );

    return [...filteredMsgs, res];
  }

  const n = messages.findIndex((m) => m.id === res.id);
  if (n === -1) {
    return [...messages, res];
  }
  return [...messages.slice(0, n), res, ...messages.slice(n + 1)];
};

type MutationOptions = SWRMutationConfiguration<
  ListChatMessagesRes,
  any,
  string,
  any,
  ListChatMessagesRes
>;

const createUpdateOptions = ({
  optimisticData,
  updatedMsg
}: {
  optimisticData: ListChatMessagesRes[0];
  updatedMsg?: ListChatMessagesRes[0];
}): MutationOptions => {
  const updatedMsgCreatedAt = updatedMsg
    ? new Date(updatedMsg.createdAt)
    : undefined;

  return {
    optimisticData: (msgs = []) => {
      const filteredMsgs = updatedMsgCreatedAt
        ? msgs.filter((msg) => new Date(msg.createdAt) < updatedMsgCreatedAt)
        : msgs;
      return [...filteredMsgs, optimisticData];
    },
    populateCache: (updatedMessages, msgs = []) => {
      const filteredMsgs = updatedMsgCreatedAt
        ? msgs.filter((msg) => new Date(msg.createdAt) < updatedMsgCreatedAt)
        : msgs;
      return [...filteredMsgs, ...updatedMessages];
    },
    revalidate: false,
    rollbackOnError: true
  };
};

interface UseChatArgs {
  chatId: string;
}

export const useChat = ({ chatId }: UseChatArgs) => {
  const [registered, setRegistered] = useState(false);

  const [messageToEdit, setMessageToEdit] = useMessageToEdit(chatId);

  const [messages, setMessages] = useMessages(chatId);

  const { lastJsonMessage, readyState, sendJsonMessage } = useWebSocket<
    StreamMsgOut | undefined
  >('/api/p/chats/ws');

  const { data: chatMessages, mutate } = useSWR<ListChatMessagesRes>(
    chatId && registered ? `/p/chats/${chatId}/messages` : null
  );

  const { isMutating, trigger: createUpdateMsg } = useSWRMutation(
    `/p/chats/${chatId}/messages`,
    postFetch<CreateUpdateChatMessageReq, ListChatMessagesRes>,
    { revalidate: false }
  );

  const form = useForm<CreateUpdateChatMessageReq>({
    defaultValues: { text: '' },
    mode: 'onChange',
    resolver: zodResolver(createUpdateChatMessageReq)
  });

  const resetForm = () => {
    form.reset({ text: '' });
    setMessageToEdit(undefined);
  };

  useEffect(() => {
    if (messageToEdit) {
      form.reset({ messageId: messageToEdit.id, text: messageToEdit.text });
    }
  }, [chatId, messageToEdit]);

  useEffect(() => {
    if (chatMessages) {
      setMessages(chatMessages);
    }
  }, [chatMessages]);

  const addUpdateMessage = async (
    values: Readonly<CreateUpdateChatMessageReq>
  ) => {
    const optimisticData: ListChatMessagesRes[0] = {
      createdAt: new Date(),
      html: values.text,
      id: crypto.randomUUID()
    };

    await createUpdateMsg(
      values,
      createUpdateOptions({ optimisticData, updatedMsg: messageToEdit })
    );

    resetForm();
  };

  useEffect(() => {
    if (chatId && readyState === ReadyState.OPEN) {
      sendJsonMessage<RegisterChatClient>({
        chatId,
        msgType: 'registerChatClient'
      });
    }
  }, [readyState, chatId, sendJsonMessage]);

  useEffect(() => {
    if (lastJsonMessage?.msgType === 'clientRegistered') {
      setRegistered(true);
    }
    if (lastJsonMessage?.msgType === 'updateChatMessage') {
      mutate(setMessageResponse(lastJsonMessage, chatMessages ?? []), {
        revalidate: false
      });
    }
  }, [lastJsonMessage]);

  const isEditing = messageToEdit !== undefined;
  return {
    addUpdateMessage,
    form,
    isEditing,
    isMutating,
    messages,
    resetForm,
    setMessageToEdit
  };
};

interface UseNewChatArgs {
  agentId: string;
  onCreate: (chatId: string) => void;
}

export const useNewChat = ({ agentId, onCreate }: UseNewChatArgs) => {
  const { isMutating, trigger: createChatTrigger } = useSWRMutation(
    `/p/chats`,
    postFetch<CreateChatReq, { id: string }>
  );

  const form = useForm<CreateChatReq>({
    defaultValues: {
      agentId,
      text: ''
    },
    mode: 'onChange',
    resolver: zodResolver(createChatReq)
  });

  const createChat = async (values: Readonly<CreateChatReq>) => {
    const { id } = await createChatTrigger(values);
    onCreate(id);
  };

  return {
    createChat,
    form,
    isMutating
  };
};
