import { Button } from '@/components/ui/button.js';
import { postFetch } from '@/lib/fetchers.js';
import { GetUserRes } from '@/types/users.js';
import {
  Cable,
  Copy,
  CornerDownRight,
  FilePenLine,
  Redo2,
  Reply
} from 'lucide-react';
import useSWRMutation from 'swr/mutation';

import { Message } from './types.js';
import { useChatShow } from './useChatList.js';
import { useMessageEditor } from './useMessageEditor.js';
import { useSidebar } from './useSidebar.js';

interface ToolbarProps {
  chatId: string;
  message: Message;
  toolbar?: boolean;
  user?: GetUserRes;
}

export const Toolbar = ({ chatId, message, user }: ToolbarProps) => {
  const flair = () => {
    const items = [];
    if (message.threadId) {
      items.push(<ThreadLink key="threadLink" message={message} />);
    }
    return items;
  };

  const tools = () => {
    if (message.error) {
      return [<RetryButton key="retry" message={message} />];
    }
    const items = [<CopyButton key="copy" message={message} />];

    if (message.agent !== undefined) {
      items.push(<ReplyButton message={message} />);
    }

    if (message.user && user && message.user.id === user?.id) {
      items.push(<EditButton key="edit" message={message} />);
    }

    if (!message.threadId) {
      items.push(
        <CreateThreadButton
          chatId={chatId}
          key="createThread"
          message={message}
        />
      );
    }
    return items;
  };

  const toolList = tools();
  const flairList = flair();

  let cornerDownRightCss = 'hidden';

  if (flairList.length > 0) {
    cornerDownRightCss = 'block';
  } else if (toolList.length > 0) {
    cornerDownRightCss = 'opacity-0 group-hover:opacity-100';
  }

  return (
    <div className="flex items-center w-full h-7">
      <div className={cornerDownRightCss}>
        <CornerDownRight className="stroke-accent" size={20} />
      </div>
      <div className="flex gap-1 h-8">{...flairList}</div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100">
        {...toolList}
      </div>
    </div>
  );
};

type ToolbarButtonProps = { chatId?: string } & Omit<ToolbarProps, 'chatId'>;

const EditButton = ({ message }: ToolbarButtonProps) => {
  const [, setMessageToEdit] = useMessageEditor(message.chatId);

  return (
    <Button onClick={() => setMessageToEdit(message)} size="sm" variant="ghost">
      <FilePenLine className="mr-1" size={15} />
      Edit
    </Button>
  );
};

const RetryButton = ({ message }: ToolbarButtonProps) => {
  const key = `/a/messages/${message.id}/retry`;
  const { trigger: updateChatMessage } = useSWRMutation(key, postFetch);

  return (
    <Button onClick={() => updateChatMessage()} size="sm" variant="ghost">
      <Redo2 className="mr-1" size={15} />
      Retry
    </Button>
  );
};

const ReplyButton = ({ message }: ToolbarButtonProps) => {
  const [, setMessage] = useMessageEditor(message.chatId);

  const fn = () =>
    message.agent
      ? setMessage({ mentions: [{ agentId: message.agent.id }] })
      : null;

  return (
    <Button onClick={fn} size="sm" variant="ghost">
      <Reply className="mr-1" size={15} />
      Reply
    </Button>
  );
};

const CopyButton = ({ message }: ToolbarButtonProps) => {
  const copyToClipboard = () => {
    if (message.text) navigator.clipboard.writeText(message.text);
  };

  return (
    <Button onClick={copyToClipboard} size="sm" variant="ghost">
      <Copy className="mr-1" size={15} />
      Copy
    </Button>
  );
};

const CreateThreadButton = ({ chatId, message }: ToolbarButtonProps) => {
  const { chat } = useChatShow(chatId);
  const { addChat } = useSidebar();

  if (!chat) {
    return null;
  }

  return (
    <Button
      onClick={() =>
        addChat({
          agentId: chat.agent.id,
          chatId: `${chatId}-new`,
          messageIds: [message.id],
          refChatId: chatId
        })
      }
      size="sm"
      variant="ghost"
    >
      <Cable className="mr-1" size={15} />
      Start Thread
    </Button>
  );
};

const ThreadLink = ({ message }: ToolbarButtonProps) => {
  const { addChat } = useSidebar();

  return (
    <Button
      onClick={() => message.threadId && addChat({ chatId: message.threadId })}
      size="sm"
      variant="ghost"
    >
      <Cable className="mr-1" size={15} />
      Thread
    </Button>
  );
};
