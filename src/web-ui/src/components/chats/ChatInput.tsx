import { FileList } from '@/components/FileList.js';
import { FileUploadButton } from '@/components/FileUploadButton.js';
import { AgentSelect } from '@/components/agents/AgentSelect.js';
import { useAgentList } from '@/components/agents/useAgentList.js';
import { Button } from '@/components/ui/button.js';
import {
  Form,
  FormControl,
  FormField,
  FormItem
} from '@/components/ui/form.js';
import { ListAgentsRes } from '@/types/agents.js';
import { CreateUpdateChatMessageReq } from '@/types/messages.js';
import {
  AlertTriangle,
  AtSign,
  CircleAlert,
  X,
  XCircle,
  XSquare
} from 'lucide-react';
import { useState } from 'react';
import { UseFieldArrayReturn } from 'react-hook-form';
import { useLocation } from 'wouter';

import { ChatTextarea } from './ChatTextarea.js';
import {
  OptionalChatFields,
  UseChatReturn,
  useChat,
  useNewChat
} from './useChat.js';
import { useChatShow } from './useChatList.js';
import { useSidebar } from './useSidebar.js';

interface ChatInputNewProps {
  agentId: string;
  chatId?: string;
  messageIds?: string[];
  refChatId?: string;
}

export const ChatInputNew = ({
  agentId,
  chatId,
  messageIds,
  refChatId
}: Readonly<ChatInputNewProps>) => {
  const { replaceChat } = useSidebar();
  const [, navigate] = useLocation();

  const onCreate = (newChatId: string) => {
    if (refChatId && chatId) {
      replaceChat(chatId, { chatId: newChatId });
    } else {
      navigate(`/chats/${newChatId}`);
    }
  };

  const chatControl = useNewChat({
    agentId,
    messageIds,
    onCreate,
    refChatId
  });

  return <ChatInputForm chatControl={chatControl} />;
};

interface UpdateChatInputProps {
  chatId: string;
}

export const ChatInput = ({ chatId }: Readonly<UpdateChatInputProps>) => {
  const chatControl = useChat(chatId);

  return <ChatInputForm chatControl={chatControl} />;
};

const MentionedList = ({
  agents,
  mentions
}: {
  agents?: ListAgentsRes;
  mentions: UseFieldArrayReturn<
    CreateUpdateChatMessageReq,
    'mentions',
    'agentId'
  >;
}) => {
  if (mentions?.fields.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center px-3 py-1 pb-4 -mb-5">
      <div className="text-sm">Mentioned:</div>
      {mentions?.fields.map((m, index) => {
        const agent = agents?.find((a) => a.id === m.agentId);
        return (
          <div
            className="flex px-2 py-1 gap-2 rounded-full text-sm font-semibold hover:bg-gray-100"
            key={m.agentId}
          >
            <div>{agent?.name}</div>
            <button onClick={() => mentions.remove(index)}>
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

interface ChatInputFormProps {
  chatControl: Omit<UseChatReturn, OptionalChatFields> &
    Partial<Pick<UseChatReturn, OptionalChatFields>>;
}

// Generic component definition
const ChatInputForm = ({
  chatControl: {
    addFile,
    chatDone,
    chatId,
    files,
    form,
    isDisabled,
    isEditing,
    isMutating,
    mentions,
    removeFile,
    resetForm,
    submit
  }
}: ChatInputFormProps) => {
  const { agents } = useAgentList();
  const [confirmChatDone, setConfirmChatDone] = useState(false);
  const { chat } = useChatShow(chatId);

  if (chat?.isDone) {
    return null;
  }

  if (confirmChatDone && chatDone) {
    return (
      <ChatDoneBanner
        onCancel={() => setConfirmChatDone(false)}
        onDone={chatDone}
      />
    );
  }

  return (
    <div className="mx-1">
      <div className="w-full space-y-2 p-3 border-2 border-accent rounded-xl relative">
        {(isEditing || form.formState.isDirty) && (
          <Button
            className="top-1 right-1 absolute text-accent rounded-full"
            onClick={resetForm}
            size="icon"
            variant="ghost"
          >
            <XCircle size={30} />
          </Button>
        )}

        {isEditing && (
          <div className="flex gap-2 text-sm text-blue-500 px-3">
            <CircleAlert size={20} />
            All messages after the edited message will be removed
          </div>
        )}

        <Form {...form}>
          <div className="space-y-1 w-full">
            <MentionedList agents={agents} mentions={mentions} />

            <FileList files={files} onRemove={removeFile} />

            <FormField
              control={form.control}
              name={'text'}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <ChatTextarea
                      className="bg-transparent border-0 focus-visible:ring-0"
                      disabled={isMutating}
                      maxTextSizeBeforeFile={1000}
                      onChange={field.onChange}
                      onEnterKeyPressed={
                        isDisabled ? undefined : form.handleSubmit(submit)
                      }
                      onFileAdded={addFile}
                      value={field.value}
                    >
                      <div className="flex items-center gap-1">
                        {chat?.isReferenced && (
                          <Button
                            onClick={() => setConfirmChatDone(true)}
                            size="sm"
                            variant="outline"
                          >
                            Chat Done
                          </Button>
                        )}

                        <AgentSelect
                          label={<AtSign size={20} />}
                          onSelect={(agentId) => {
                            mentions.append({ agentId });
                          }}
                          selected={mentions.fields.map((m) => m.agentId)}
                          size="icon"
                          variant="ghost"
                        />

                        <FileUploadButton onFilesAdded={addFile} />
                      </div>
                    </ChatTextarea>
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
        </Form>
      </div>
    </div>
  );
};

interface ChatDoneBannerProps {
  onCancel: () => void;
  onDone: () => void;
}

const ChatDoneBanner = ({ onCancel, onDone }: ChatDoneBannerProps) => {
  return (
    <div className="p-4 space-y-2 shadow-md border rounded-xl m-2">
      <div className="flex items-start gap-1 text-red-500">
        <AlertTriangle size={25} />
        This action cannot be undone. Please confirm that you want to proceed.
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onDone}>Chat Done</Button>
        <Button onClick={onCancel} variant="outline">
          Cancel
        </Button>
      </div>
    </div>
  );
};
