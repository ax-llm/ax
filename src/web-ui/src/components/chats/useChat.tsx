import { postFetch, postFetchMP } from '@/lib/fetchers';
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

import { Message } from './types.js';
import { UploadedFile, useFiles } from './useFiles.js';
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

export interface UseChatReturn {
  addFile: (file: UploadedFile | UploadedFile[]) => void;
  chatDone: () => void;
  chatId: string;
  files: UploadedFile[];
  form: UseFormReturn<CreateUpdateChatMessageReq>;
  isDisabled: boolean;
  isEditing: boolean;
  isMutating: boolean;
  mentions: UseFieldArrayReturn<CreateUpdateChatMessageReq, 'mentions', 'id'>;
  removeFile: (index: number) => void;
  resetForm: () => void;
  setMessage: (msg: Message | undefined) => void;
  submit: (values: Readonly<CreateUpdateChatMessageReq>) => void;
}

export const useChat = (chatId: string): UseChatReturn => {
  const [registered, setRegistered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [message, setMessage] = useMessageEditor(chatId);
  const [, setMessages] = useMessages(chatId);
  const { addFile, clearFiles, files, getFilesAsFormData, removeFile } =
    useFiles();

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
    postFetchMP
  );

  const form = useForm<CreateUpdateChatMessageReq>({
    defaultValues: { mentions: [], text: '' },
    mode: 'all',
    resolver: zodResolver(createUpdateChatMessageReq)
  });

  const mentions = useFieldArray({
    control: form.control,
    name: 'mentions'
  });

  const resetForm = () => {
    clearFiles();
    mentions.replace([]);
    setMessage(undefined);
    form.reset({ mentions: [], messageId: undefined, text: '' });
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

  const submit = async (values: Readonly<CreateUpdateChatMessageReq>) => {
    const formData = await getFilesAsFormData();
    formData.append('json', JSON.stringify(values));
    await createUpdateMsg(formData);
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
    addFile,
    chatDone: chatDoneHandler,
    chatId,
    files,
    form,
    isDisabled: isMutating || !form.formState.isValid || !chatId,
    isEditing,
    isMutating,
    mentions,
    removeFile,
    resetForm,
    setMessage,
    submit
  };
};

interface UseNewChatArgs {
  agentId: string;
  messageIds?: string[];
  onCreate: (chatId: string) => void;
  refChatId?: string;
}

export type OptionalChatFields =
  | 'chatDone'
  | 'chatId'
  | 'isEditing'
  | 'setMessage';

export type UseNewChatReturn = Omit<UseChatReturn, OptionalChatFields>;

export const useNewChat = ({
  agentId,
  messageIds,
  onCreate,
  refChatId
}: UseNewChatArgs): UseNewChatReturn => {
  const { addFile, clearFiles, files, getFilesAsFormData, removeFile } =
    useFiles();

  const { isMutating, trigger: createChat } = useSWRMutation(
    agentId ? `/a/chats` : null,
    postFetchMP<{ id: string }>
  );

  const form = useForm<CreateUpdateChatMessageReq>({
    defaultValues: { mentions: [], text: '' },
    mode: 'all',
    resolver: zodResolver(createUpdateChatMessageReq)
  });

  const mentions = useFieldArray({
    control: form.control,
    name: 'mentions'
  });

  const submit = async (values: Readonly<CreateUpdateChatMessageReq>) => {
    const formData = await getFilesAsFormData();

    const jsonValues: CreateChatReq = {
      ...values,
      agentId,
      messageIds,
      refChatId
    };
    formData.append('json', JSON.stringify(jsonValues));

    const { id } = await createChat(formData);
    resetForm();
    onCreate(id);
  };

  const resetForm = () => {
    clearFiles();
    mentions.replace([]);
    form.reset({ mentions: [], messageId: undefined, text: '' });
  };

  return {
    addFile,
    files,
    form,
    isDisabled: isMutating || !form.formState.isValid || !agentId,
    isMutating,
    mentions,
    removeFile,
    resetForm,
    submit
  };
};
