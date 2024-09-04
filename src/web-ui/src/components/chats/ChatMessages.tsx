import { Button } from '@/components/ui/button.js';
import { postFetch } from '@/lib/fetchers';
import { BotMessageSquare, Circle, MessageSquare } from 'lucide-react';
import { useEffect, useRef } from 'react';
import useSWRMutation from 'swr/mutation';

import type { Message } from './types.js';

import { useMessageToEdit } from './useMessageToEdit.js';
import { useMessagesValue } from './useMessages.js';

interface ChatMessagesProps {
  chatId: string;
}

export const ChatMessages = ({ chatId }: ChatMessagesProps) => {
  const messages = useMessagesValue(chatId);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-grow overflow-y-auto">
      <div className="overflow-y-auto">
        {messages?.map((m) => <Message key={m.id} message={m} />)}
      </div>
      <div ref={messagesEndRef} />
    </div>
  );
};

export const EmptyChatMessages = () => {
  return (
    <div className="flex-grow">
      <div className="p-4"></div>
    </div>
  );
};

interface MessageProps {
  message: Message;
}

const Message = ({ message }: Readonly<MessageProps>) => {
  const statusComponent = () => {
    if (message.processing === true) {
      return <TypingIndicator />;
    }
    if (message.error) {
      return <ResponseContent message={message} />;
    }
    return <ResponseContent message={message} />;
  };

  return (
    <div
      className="flex gap-3 transform transition-all duration-300 animate-enter hover:bg-gray-100/50 px-4 py-3"
      key={message.id}
    >
      <div className="mt-1">
        {message.agent ? (
          <BotMessageSquare className="stroke-gray-400" size={20} />
        ) : (
          <MessageSquare className="stroke-gray-400" size={20} />
        )}
      </div>
      <div className="text-lg w-full">{statusComponent()}</div>
    </div>
  );
};

const ResponseContent = ({ message }: Readonly<MessageProps>) => {
  return (
    <div className="flex justify-between w-full group">
      <div className="space-y-2 w-full overflow-hidden">
        {message.html && (
          <div
            className="text-gray-600 overflow-auto max-w-full markdown"
            dangerouslySetInnerHTML={{ __html: message.html }}
          />
        )}
        {message.text && <div className="text-gray-600">{message.text}</div>}
        {message.error && <div className="text-red-500">{message.error}</div>}
      </div>

      <Toolbar message={message} />
    </div>
  );
};

const Toolbar = ({ message }: MessageProps) => {
  return (
    <div className="group-hover:block opacity-0 group-hover:opacity-100 transition-opacity duration-800 ease-in-out">
      <div className="flex gap-2 relative right-5 border bg-primary px-3 rounded-full">
        {message.error && <RetryButton message={message} />}
        {!message.agent && <EditButton message={message} />}
      </div>
    </div>
  );
};

const EditButton = ({ message }: MessageProps) => {
  const [, setMessageToEdit] = useMessageToEdit(message.chatId);

  return (
    <Button onClick={() => setMessageToEdit(message)} size="sm">
      Edit
    </Button>
  );
};

const RetryButton = ({ message }: MessageProps) => {
  const key = `/p/chats/${message.chatId}/messages/${message.id}/retry`;
  const { trigger: updateChatMessage } = useSWRMutation(key, postFetch);

  return (
    <Button onClick={() => updateChatMessage()} size="sm">
      Retry
    </Button>
  );
};

const TypingIndicator = () => (
  <div className="flex items-center space-x-2 rounded-full px-4 py-2 w-20">
    <Circle className="w-3 h-3 animate-bounce" />
    <Circle
      className="w-3 h-3 animate-bounce"
      style={{ animationDelay: '0.2s' }}
    />
    <Circle
      className="w-3 h-3 animate-bounce"
      style={{ animationDelay: '0.4s' }}
    />
  </div>
);
