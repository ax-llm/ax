import { ChatCard } from '@/components/agents/ChatCard';
import { UpdateChatInput } from '@/components/chats/ChatInput';
import { ChatMessages } from '@/components/chats/ChatMessages';
import { ListChatMessagesRes } from '@/types/messages';
import { StreamMsgIn, StreamMsgOut } from '@/types/stream';
import { useEffect, useState } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import useSWR, { KeyedMutator } from 'swr';
import { useParams } from 'wouter';

type RegisterChatClient = Extract<
  StreamMsgIn,
  { msgType: 'registerChatClient' }
>;

export const UpdateChat = () => {
  const { chatId } = useParams<{ chatId: string }>();
  const [registered, setRegistered] = useState(false);

  const { lastJsonMessage, readyState, sendJsonMessage } = useWebSocket<
    StreamMsgOut | undefined
  >('/api/p/chats/ws');

  const { data: messages, mutate: mutateMessages } =
    useSWR<ListChatMessagesRes>(
      chatId && registered ? `/p/chats/${chatId}/messages` : null
    );

  useEffect(() => {
    if (chatId && readyState === ReadyState.OPEN) {
      sendJsonMessage<RegisterChatClient>({
        chatId,
        msgType: 'registerChatClient'
      });
    }
  }, [readyState]);

  useEffect(() => {
    if (lastJsonMessage?.msgType === 'clientRegistered') {
      setRegistered(true);
    }
  }, [lastJsonMessage]);

  return (
    <UpdateChatForm
      chatId={chatId}
      messages={messages ?? []}
      mutateMessages={mutateMessages}
      streamMsg={lastJsonMessage}
    />
  );
};

interface UpdateChatProps {
  chatId: string;
  messages: ListChatMessagesRes;
  mutateMessages: KeyedMutator<ListChatMessagesRes>;
  streamMsg?: StreamMsgOut;
}

export const UpdateChatForm = ({
  chatId,
  messages,
  mutateMessages,
  streamMsg
}: Readonly<UpdateChatProps>) => {
  useEffect(() => {
    if (streamMsg?.msgType === 'updateChatMessage') {
      mutateMessages(setMessageResponse(streamMsg, messages), {
        revalidate: false
      });
    }
  }, [streamMsg]);

  return (
    <div>
      <ChatCard chatId={chatId} />
      <div className="flex flex-col h-[calc(100vh-55px)] gap-2 bg-white shadow-md rounded-lg pt-2">
        <ChatMessages chatId={chatId} messages={messages} />
        <UpdateChatInput chatId={chatId} />
      </div>
    </div>
  );
};

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
