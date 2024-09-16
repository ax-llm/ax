import { NewChat } from '@/components/chats/Chat';
import { useSearch } from 'wouter';

export const CreateChat = () => {
  const query = useSearch();
  const qs = new URLSearchParams(query);
  const agentId = qs.get('agentId');
  const messageIds = qs.get('messageIds') ?? undefined;
  const refChatId = qs.get('refChatId') ?? undefined;

  if (!agentId) {
    return <div>No agent selected</div>;
  }

  return (
    <NewChat
      agentId={agentId}
      messageIds={messageIds?.split(',')}
      refChatId={refChatId}
    />
  );
};
