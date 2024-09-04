import { Chat } from '@/components/chats/Chat';
import { useParams } from 'wouter';

export const UpdateChat = () => {
  const { chatId } = useParams<{ chatId: string }>();
  return <Chat chatId={chatId} />;
};
