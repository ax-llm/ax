import { NewChat } from '@/components/chats/Chat';
import { useSearch } from 'wouter';

export const CreateChat = () => {
  const query = useSearch();
  const qs = new URLSearchParams(query);
  const agentId = qs.get('agentId');

  if (!agentId) {
    return <div>No agent selected</div>;
  }

  return <NewChat agentId={agentId} />;
};
