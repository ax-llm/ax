import { AgentHoverCard } from '@/components/agents/AgentHoverCard';
import { CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { timeSince } from '@/lib/utils';
import { GetChatRes } from '@/types/chats';
import { Cable } from 'lucide-react';

interface ChatCardProps {
  chat: GetChatRes;
}

export const ChatCard = ({ chat }: Readonly<ChatCardProps>) => {
  return (
    <>
      <CardHeader>
        <CardTitle>
          <div className="flex items-center space-x-2">
            {chat.isReferenced && (
              <Cable className="stroke-foreground/50" size={20} />
            )}
            <div className="text-sm text-foreground/60 font-normal">
              {timeSince(chat.updatedAt)}
            </div>
          </div>
          <span className="text-2xl font-normal">{chat.title}</span>
        </CardTitle>
      </CardHeader>

      <CardFooter className="space-x-2">
        <div className="flex -space-x-2">
          {(chat.agents ?? []).map((agent) => (
            <AgentHoverCard agent={agent} key={agent.id} size="md" />
          ))}
        </div>
      </CardFooter>
    </>
  );
};
