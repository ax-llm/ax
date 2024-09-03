import { AgentCard } from '@/components/agents/AgentCard.js';
import { CreateChatInput } from '@/components/chats/ChatInput.js';
import { EmptyChatMessages } from '@/components/chats/ChatMessages.js';
import { useSearch } from 'wouter';

export const CreateChat = () => {
  const query = useSearch();
  const qs = new URLSearchParams(query);
  const agentId = qs.get('agentId');

  if (!agentId) {
    return <div>No agent selected</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] gap-2">
      <AgentCard agentId={agentId} />
      <div className="flex flex-col h-[calc(100vh-30px)] gap-2 bg-white shadow rounded-lg">
        <EmptyChatMessages />
        <CreateChatInput agentId={agentId} />
      </div>
    </div>
  );
};
