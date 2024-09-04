import { TextInput } from '@/components/TextInput.js';
import { Button } from '@/components/ui/button.js';
import {
  Form,
  FormControl,
  FormField,
  FormItem
} from '@/components/ui/form.js';
import { CreateChatReq } from '@/types/chats.js';
import { CreateUpdateChatMessageReq } from '@/types/messages.js';
import { CircleAlert } from 'lucide-react';
import { FieldPath, UseFormReturn } from 'react-hook-form';
import { useLocation } from 'wouter';

import { useChat, useNewChat } from './useChat.js';

interface BaseChatReq {
  text: string;
}

interface CreateChatInputProps {
  agentId: string;
}

export const CreateChatInput = ({
  agentId
}: Readonly<CreateChatInputProps>) => {
  const [, navigate] = useLocation();

  const { createChat, form, isMutating } = useNewChat({
    agentId,
    onCreate: (chatId) => navigate(`/chats/${chatId}`)
  });

  return (
    <ChatInputForm<CreateChatReq>
      clear={form.reset}
      form={form}
      isEditing={false}
      isMutating={isMutating}
      submit={createChat}
    />
  );
};

interface UpdateChatInputProps {
  chatId: string;
}

export const UpdateChatInput = ({ chatId }: Readonly<UpdateChatInputProps>) => {
  const { addUpdateMessage, form, isEditing, isMutating, resetForm } = useChat({
    chatId
  });

  return (
    <ChatInputForm<CreateUpdateChatMessageReq>
      clear={resetForm}
      form={form}
      isEditing={isEditing}
      isMutating={isMutating}
      note={
        isEditing
          ? 'All messages after the edited message will be removed'
          : undefined
      }
      submit={addUpdateMessage}
      submitLabel={isEditing ? 'Update' : 'Send'}
    />
  );
};

interface ChatInputFormProps<T extends BaseChatReq> {
  clear: () => void;
  form: UseFormReturn<T>; // UseFormReturn with the generic T
  isEditing?: boolean;
  isMutating: boolean;
  note?: string;
  submit: (values: T) => void; // Submit function takes data of type T
  submitLabel?: string;
}

// Generic component definition
const ChatInputForm = <T extends BaseChatReq>({
  clear,
  form,
  isEditing,
  isMutating,
  note,
  submit,
  submitLabel
}: ChatInputFormProps<T>) => {
  return (
    <div className="w-full space-y-2 p-3">
      {note && (
        <div className="flex gap-2 text-sm text-blue-500 px-3">
          <CircleAlert size={20} />
          {note}
        </div>
      )}
      <div className="bg-gray-100 rounded-xl p-2">
        <Form {...form}>
          <FormField
            control={form.control}
            name={'text' as FieldPath<T>}
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <TextInput
                    className="placeholder:text-gray-300/80 focus-visible:ring-offset-0"
                    disabled={isMutating}
                    error={form.formState.errors.text?.message as string}
                    maxLength={1000}
                    placeholder={'Enter your message'}
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <div className="p-1 space-x-1">
            <Button
              disabled={isMutating || !form.formState.isValid}
              onClick={form.handleSubmit(submit)}
              size="xs"
            >
              {submitLabel ?? 'Send'}
            </Button>
            {(isEditing || form.formState.isDirty) && (
              <Button onClick={clear} size="xs" variant="outline">
                Cancel
              </Button>
            )}
          </div>
        </Form>
      </div>
    </div>
  );
};
