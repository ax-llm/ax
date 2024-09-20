import { XButton } from '@/components/XButton.js';
import { AgentHoverCard } from '@/components/agents/AgentHoverCard.js';
import { useAgentShow } from '@/components/agents/useAgentList.js';
import { useCurrentUser } from '@/components/hooks/useUser.js';
import { Button } from '@/components/ui/button.js';
import { UserHoverCard } from '@/components/users/UserHoverCard.js';
import { Cable, Edit, Edit2, Loader2, Milestone, X } from 'lucide-react';
import { Link } from 'wouter';

import { useChatShow } from './useChatList.js';
import { useSetChatTitle } from './useSetChatTitle.js';
import { useSidebar } from './useSidebar.js';

export const ChatHeader = ({
  chatId,
  isThread,
  showClose
}: {
  chatId: string;
  isThread?: boolean;
  showClose?: boolean;
}) => {
  const { removeChat } = useSidebar();
  const { isUpdatingTitle, updateTitle } = useSetChatTitle(chatId);
  const { chat } = useChatShow(chatId);

  if (!chat) {
    return null;
  }

  return (
    <>
      <div className="flex justify-between items-center border-b p-2 px-4">
        <div className="flex gap-2 items-center font-medium w-full truncate text-ellipsis">
          {isThread ? (
            <Link
              className="flex items-center gap-2"
              target="_blank"
              to={`/chats/${chatId}`}
            >
              <Cable size={20} />
              {chat.title}
            </Link>
          ) : (
            <div>{chat.title}</div>
          )}
          {chat.isTitleUpdatable && (
            <Button onClick={updateTitle} size="icon" variant="ghost">
              {isUpdatingTitle ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Edit2 size={15} />
              )}
            </Button>
          )}

          <div className="flex -space-x-2 ml-4">
            {chat.agents?.map((agent) => (
              <AgentHoverCard agent={agent} key={agent.id} size="xl" />
            ))}
            <UserHoverCard key={chat.user.id} user={chat.user} />
          </div>
        </div>
        {showClose && (
          <Button onClick={() => removeChat(chatId)} size="xs" variant="ghost">
            <X size={20} />
          </Button>
        )}
      </div>
    </>
  );
};

export const ChatHeaderNew = ({
  agentId,
  chatId,
  isThread
}: {
  agentId: string;
  chatId?: string;
  isThread?: boolean;
}) => {
  const { removeChat } = useSidebar();
  const { agent } = useAgentShow(agentId);
  const { user } = useCurrentUser();

  if (!agent) {
    return null;
  }

  return (
    <div className="flex justify-between items-center border-b p-2 px-4 w-full">
      <div className="flex gap-2 items-center font-medium">
        <div className="flex items-center gap-2">
          {isThread && <Cable size={20} />}
          New Chat with {agent.name}
        </div>
        <div className="flex -space-x-2">
          <AgentHoverCard agent={agent} size="xl" />
          {user && <UserHoverCard key={user.id} user={user} />}
        </div>
      </div>
      {chatId && (
        <Button onClick={() => removeChat(chatId)} size="xs" variant="ghost">
          <X size={20} />
        </Button>
      )}
    </div>
  );
};

export const ChatInfoBanner = ({ chatId }: { chatId: string }) => {
  const { chat } = useChatShow(chatId);

  if (!chat?.isReferenced && !chat?.isDone) {
    return null;
  }

  let msg = '';
  if (chat.isDone) {
    msg = 'This chat is marked as done and is a thread in other chats.';
  } else if (chat.isReferenced) {
    msg = 'Click "chat done" to send the final message to the original chat';
  }

  return (
    <div className="flex items-center gap-2 p-3 px-4 text-accent text-sm border-b">
      <Milestone className="inline-block mr-1" size={25} />
      <div>{msg}</div>
    </div>
  );
};
