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
import { AlertTriangle, AtSign, CircleAlert, X, XSquare } from 'lucide-react';
import { useState } from 'react';
import { UseFieldArrayReturn, UseFormReturn } from 'react-hook-form';
import { useLocation } from 'wouter';

import { ChatTextarea } from './ChatTextarea.js';
import { useChat, useNewChat } from './useChat.js';
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

  const { createChat, form, isDisabled, isMutating, mentions } = useNewChat({
    agentId,
    messageIds,
    onCreate,
    refChatId
  });

  return (
    <ChatInputForm
      clear={form.reset}
      form={form}
      isDisabled={isDisabled}
      isEditing={false}
      isMutating={isMutating}
      mentions={mentions}
      submit={createChat}
    />
  );
};

interface UpdateChatInputProps {
  chatId: string;
}

export const ChatInput = ({ chatId }: Readonly<UpdateChatInputProps>) => {
  const {
    addUpdateMessage,
    chatDone,
    form,
    isDisabled,
    isEditing,
    isMutating,
    mentions,
    resetForm
  } = useChat(chatId);

  return (
    <ChatInputForm
      chatDone={chatDone}
      chatId={chatId}
      clear={resetForm}
      form={form}
      isDisabled={isDisabled}
      isEditing={isEditing}
      isMutating={isMutating}
      mentions={mentions}
      note={
        isEditing
          ? 'All messages after the edited message will be removed'
          : undefined
      }
      submit={addUpdateMessage}
    />
  );
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
  chatDone?: () => void;
  chatId?: string;
  clear: () => void;
  form: UseFormReturn<CreateUpdateChatMessageReq>;
  isDisabled: boolean;
  isEditing?: boolean;
  isMutating: boolean;
  mentions: UseFieldArrayReturn<
    CreateUpdateChatMessageReq,
    'mentions',
    'agentId'
  >;
  note?: string;
  submit: (values: CreateUpdateChatMessageReq) => void;
}

// Generic component definition
const ChatInputForm = ({
  chatDone,
  chatId,
  clear,
  form,
  isDisabled,
  isEditing,
  isMutating,
  mentions,
  note,
  submit
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
    <div className="w-full space-y-2 p-3 border-2 border-accent rounded-xl">
      {note && (
        <div className="flex gap-2 text-sm text-blue-500 px-3">
          <CircleAlert size={20} />
          {note}
        </div>
      )}

      <Form {...form}>
        <div className="flex justify-between">
          <div className="space-y-1 w-full">
            <MentionedList agents={agents} mentions={mentions} />

            <FormField
              control={form.control}
              name={'text'}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <ChatTextarea
                      className="bg-transparent border-0 focus-visible:ring-0"
                      disabled={isMutating}
                      // error={form.formState.errors.text?.message as string}
                      // maxLength={1000}
                      onChange={field.onChange}
                      onEnterKeyPressed={
                        !isDisabled ? form.handleSubmit(submit) : undefined
                      }
                      value={field.value}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

          {(isEditing || form.formState.isDirty) && (
            <Button onClick={clear} size="icon" variant="ghost">
              <XSquare size={30} />
            </Button>
          )}
        </div>

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
        </div>
      </Form>
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
