import { AgentCard } from '@/components/agents/AgentCard.js';
import { ChatCard } from '@/components/agents/ChatCard.js';

import { CreateChatInput, UpdateChatInput } from './ChatInput.js';
import { ChatMessages, EmptyChatMessages } from './ChatMessages.js';

export const Chat = ({ chatId }: { chatId: string }) => {
  return (
    <div className="space-y-2 pt-2">
      <ChatCard chatId={chatId} />
      <div className="flex flex-col h-[calc(100vh-70px)] gap-2 bg-white shadow-md rounded-lg pt-2">
        <ChatMessages chatId={chatId} />
        <UpdateChatInput chatId={chatId} />
      </div>
    </div>
  );
};

export const NewChat = ({ agentId }: { agentId: string }) => {
  return (
    <div className="space-y-2 pt-2">
      <AgentCard agentId={agentId} />
      <div className="flex flex-col h-[calc(100vh-70px)] gap-2 bg-white shadow-md rounded-lg pt-2">
        <EmptyChatMessages />
        <CreateChatInput agentId={agentId} />
      </div>
    </div>
  );
};
