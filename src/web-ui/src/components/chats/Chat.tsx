import { useCurrentUser } from '@/components/hooks/useUser.js';
import { ResizableHandle, ResizablePanel } from '@/components/ui/resizable.js';
import { ResizablePanelGroup } from '@/components/ui/resizable.js';
import React from 'react';

import { ChatHeader, ChatHeaderNew, ChatInfoBanner } from './ChatHeaders.js';
import { ChatInput, ChatInputNew } from './ChatInput.js';
import { ChatMessages, ChatMessagesEmpty } from './ChatMessages.js';
import { isChatNew, useSidebar } from './useSidebar.js';

interface ChatProps {
  chatId: string;
}

export const Chat = ({ chatId }: ChatProps) => {
  useCurrentUser(true);

  const { sidebarItems } = useSidebar();
  const chatSize = sidebarItems.length > 0 ? 65 : 100;
  const sidebarSize = sidebarItems.length > 0 ? 35 / sidebarItems.length : 0;

  return (
    <div className="bg-white shadow-md rounded-xl overflow-hidden">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={chatSize} id="main" order={0}>
          <ChatCore chatId={chatId} />
        </ResizablePanel>

        {sidebarItems.map((item, i) => (
          <React.Fragment key={item.chatId}>
            <ResizableHandle withHandle={true} />
            <ResizablePanel
              defaultSize={sidebarSize}
              id={item.chatId}
              order={i + 1}
            >
              {isChatNew(item) ? (
                <NewChat
                  agentId={item.agentId}
                  chatId={item.chatId}
                  messageIds={item.messageIds}
                  refChatId={item.refChatId}
                />
              ) : (
                <ChatCore chatId={item.chatId} isThread={true} />
              )}
            </ResizablePanel>
          </React.Fragment>
        ))}
      </ResizablePanelGroup>
    </div>
  );
};

interface ChatCoreProps extends ChatProps {
  isDone?: boolean;
  isThread?: boolean;
}

const ChatCore = ({ chatId, isDone, isThread }: ChatCoreProps) => {
  return (
    <div className="flex flex-col h-[calc(100vh-20px)]">
      <ChatHeader chatId={chatId} isThread={isThread} showClose={isThread} />
      <ChatInfoBanner chatId={chatId} />
      <ChatMessages chatId={chatId} isDone={isDone} />
      <ChatInput chatId={chatId} />
    </div>
  );
};

interface ChatNewProps {
  agentId: string;
  chatId?: string;
  messageIds?: string[];
  refChatId?: string;
}

export const NewChat = ({
  agentId,
  chatId,
  messageIds,
  refChatId
}: ChatNewProps) => {
  return (
    <div className="space-y-2">
      <div className="flex flex-col h-[calc(100vh-20px)] gap-2 bg-white shadow-md rounded-xl">
        <ChatHeaderNew
          agentId={agentId}
          chatId={chatId}
          isThread={refChatId !== undefined}
        />
        <ChatMessagesEmpty messageIds={messageIds} />
        <ChatInputNew
          agentId={agentId}
          chatId={chatId}
          messageIds={messageIds}
          refChatId={refChatId}
        />
      </div>
    </div>
  );
};
