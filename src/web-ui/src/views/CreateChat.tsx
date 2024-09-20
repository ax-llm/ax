import { NewChat } from '@/components/chats/Chat';
import { useParams, useSearch } from 'wouter';

export const CreateChat = () => {
  const { agentId } = useParams();
  const query = useSearch();

  const qs = new URLSearchParams(query);
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
