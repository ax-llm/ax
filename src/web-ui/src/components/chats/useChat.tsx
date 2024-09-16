import { postFetch } from '@/lib/fetchers';
import { CreateChatReq } from '@/types/chats.js';
import {
  CreateUpdateChatMessageReq,
  ListChatMessagesRes,
  createUpdateChatMessageReq
} from '@/types/messages';
import { StreamMsgIn, StreamMsgOut } from '@/types/stream';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import {
  UseFieldArrayReturn,
  UseFormReturn,
  useFieldArray,
  useForm
} from 'react-hook-form';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import useSWR, { useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';

import { Message, Messages } from './types.js';
import { useMessageEditor } from './useMessageEditor.js';
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
  // sort by createdAt old to new
  return [...messages.slice(0, n), res, ...messages.slice(n + 1)].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
};

// type MutationOptions = SWRMutationConfiguration<
//   ListChatMessagesRes,
//   any,
//   string,
//   any,
//   ListChatMessagesRes
// >;

// const createUpdateOptions = (
//   optimisticData: ListChatMessagesRes[0],
//   updatedMsgCreatedAt?: Date
// ): MutationOptions => {
//   return {
//     // optimisticData: (msgs = []) => {
//     //   console.log('optimisticData', optimisticData);

//     //   const filteredMsgs = updatedMsgCreatedAt
//     //     ? msgs.filter((msg) => new Date(msg.createdAt) < updatedMsgCreatedAt)
//     //     : msgs;
//     //   return [...filteredMsgs, optimisticData];
//     // },
//     populateCache: (updatedMessages, msgs = []) => {
//       console.log('updatedMsgCreatedAt', updatedMsgCreatedAt);

//       const filteredMsgs = updatedMsgCreatedAt
//         ? msgs.filter((msg) => new Date(msg.createdAt) < updatedMsgCreatedAt)
//         : msgs;
//       if (updatedMsgCreatedAt) {
//         return [...filteredMsgs, ...updatedMessages];
//       }
//       console.log('op id', optimisticData.id);
//       const n = msgs.findIndex((m) => m.id === optimisticData.id);
//       console.log('msgs', n, msgs);
//       if (n === -1) {
//         return [...msgs, ...updatedMessages];
//       }
//       return [...msgs.slice(0, n), ...updatedMessages, ...msgs.slice(n + 1)];
//     },
//     revalidate: false,
//     rollbackOnError: true
//   };
// };

export interface UseChatReturn {
  addUpdateMessage: (values: Readonly<CreateUpdateChatMessageReq>) => void;
  chatDone: () => void;
  form: UseFormReturn<CreateUpdateChatMessageReq>;
  isDisabled: boolean;
  isEditing: boolean;
  isMutating: boolean;
  mentions: UseFieldArrayReturn<CreateUpdateChatMessageReq, 'mentions', 'id'>;
  messages: Messages;
  resetForm: () => void;
  setMessage: (msg: Message | undefined) => void;
}

export const useChat = (chatId: string): UseChatReturn => {
  const [registered, setRegistered] = useState(false);

  const [isEditing, setIsEditing] = useState(false);

  const [message, setMessage] = useMessageEditor(chatId);

  const [messages, setMessages] = useMessages(chatId);

  const { lastJsonMessage, readyState, sendJsonMessage } = useWebSocket<
    StreamMsgOut | undefined
  >('/api/a/chats/ws', {
    retryOnError: true,
    shouldReconnect: () => true
  });

  const { mutate } = useSWRConfig();

  const { data: chatMessages, mutate: mutateMessages } =
    useSWR<ListChatMessagesRes>(
      chatId && registered ? `/a/chats/${chatId}/messages` : null
    );

  const { isMutating: isMutating1, trigger: chatDone } = useSWRMutation(
    `/a/chats/${chatId}/done`,
    postFetch
  );

  const { isMutating: isMutating2, trigger: createUpdateMsg } = useSWRMutation(
    `/a/chats/${chatId}/messages`,
    postFetch<CreateUpdateChatMessageReq, ListChatMessagesRes>
  );

  const form = useForm<CreateUpdateChatMessageReq>({
    defaultValues: { mentions: [], text: '' },
    mode: 'all',
    resolver: zodResolver(createUpdateChatMessageReq)
  });

  const mentions = useFieldArray<CreateUpdateChatMessageReq>({
    control: form.control,
    name: 'mentions'
  });

  const resetForm = () => {
    form.reset({ mentions: [], messageId: undefined, text: '' });
    mentions.replace([]);
    setMessage(undefined);
  };

  useEffect(() => {
    if (message?.id) {
      form.reset({
        mentions: message.mentions,
        messageId: message.id,
        text: message.text
      });
      setIsEditing(true);
    } else if (message) {
      if (message?.mentions) {
        mentions.replace(message.mentions);
      }
      if (message?.text) {
        form.setValue('text', message.text);
      }
    } else {
      setIsEditing(false);
    }
  }, [chatId, message]);

  useEffect(() => {
    if (chatMessages) {
      setMessages(chatMessages);
    }
  }, [chatMessages]);

  const addUpdateMessage = async (
    values: Readonly<CreateUpdateChatMessageReq>
  ) => {
    // const optimisticData: ListChatMessagesRes[0] = {
    //   createdAt: new Date(),
    //   html: values.text,
    //   id: crypto.randomUUID()
    // };

    // const updatedMsgCreatedAt =
    //   message?.updatedAt && message?.createdAt
    //     ? new Date(message.createdAt)
    //     : undefined;

    await createUpdateMsg(
      values
      //   createUpdateOptions(optimisticData, updatedMsgCreatedAt)
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
      mutateMessages(setMessageResponse(lastJsonMessage, chatMessages ?? []), {
        revalidate: false
      });
    }
  }, [lastJsonMessage]);

  const isMutating = isMutating1 || isMutating2;

  const chatDoneHandler = async () => {
    await chatDone();
    mutate(`/a/chats/${chatId}`);
  };

  return {
    addUpdateMessage,
    chatDone: chatDoneHandler,
    form,
    isDisabled: isMutating || !form.formState.isValid || !chatId,
    isEditing,
    isMutating,
    mentions,
    messages,
    resetForm,
    setMessage
  };
};

interface UseNewChatArgs {
  agentId: string;
  messageIds?: string[];
  onCreate: (chatId: string) => void;
  refChatId?: string;
}

export const useNewChat = ({
  agentId,
  messageIds,
  onCreate,
  refChatId
}: UseNewChatArgs) => {
  const { isMutating, trigger: createChatTrigger } = useSWRMutation(
    agentId ? `/a/chats` : null,
    postFetch<CreateChatReq, { id: string }>
  );

  const form = useForm<CreateUpdateChatMessageReq>({
    defaultValues: {
      text: ''
    },
    resolver: zodResolver(createUpdateChatMessageReq)
  });

  const mentions = useFieldArray({
    control: form.control,
    name: 'mentions'
  });

  const createChat = async (values: Readonly<CreateUpdateChatMessageReq>) => {
    const { id } = await createChatTrigger({
      ...values,
      agentId,
      messageIds,
      refChatId
    });
    onCreate(id);
  };

  return {
    createChat,
    form,
    isDisabled: isMutating || !form.formState.isValid || !agentId,
    isMutating,
    mentions
  };
};
