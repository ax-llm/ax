import { TextInput } from '@/components/TextInput.js';
import { Button } from '@/components/ui/button.js';
import {
  Form,
  FormControl,
  FormField,
  FormItem
} from '@/components/ui/form.js';
import { postFetch } from '@/lib/fetchers';
import { CreateChatReq, createChatReq } from '@/types/chats.js';
import {
  CreateUpdateChatMessageReq,
  ListChatMessagesRes,
  createUpdateChatMessageReq
} from '@/types/messages.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAtom } from 'jotai';
import { CircleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { FieldPath, UseFormReturn, useForm } from 'react-hook-form';
import useSWRMutation, { SWRMutationConfiguration } from 'swr/mutation';
import { useLocation } from 'wouter';

import { messageToEditAtom } from './state.js';

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

  const { isMutating, trigger: createChat } = useSWRMutation(
    `/p/chats`,
    postFetch<CreateChatReq, { id: string }>
  );

  const form = useForm<CreateChatReq>({
    defaultValues: {
      agentId,
      text: ''
    },
    mode: 'onChange',
    resolver: zodResolver(createChatReq)
  });

  const submit = async (values: Readonly<CreateChatReq>) => {
    const { id } = await createChat(values);
    navigate(`/chats/${id}`);
  };

  return (
    <ChatInputForm<CreateChatReq>
      form={form}
      isMutating={isMutating}
      submit={submit}
    />
  );
};

interface UpdateChatInputProps {
  chatId: string;
}

export const UpdateChatInput = ({ chatId }: Readonly<UpdateChatInputProps>) => {
  const [messageToEdit, setMessageToEdit] = useAtom(messageToEditAtom);

  const { isMutating, trigger: createUpdateMsg } = useSWRMutation(
    `/p/chats/${chatId}/messages`,
    postFetch<CreateUpdateChatMessageReq, ListChatMessagesRes>,
    { revalidate: false }
  );

  const form = useForm<CreateUpdateChatMessageReq>({
    defaultValues: { text: '' },
    mode: 'onChange',
    resolver: zodResolver(createUpdateChatMessageReq)
  });

  const clear = () => {
    form.reset({ text: '' });
    setMessageToEdit(undefined);
  };

  useEffect(() => {
    if (messageToEdit) {
      form.reset({ messageId: messageToEdit?.id, text: messageToEdit.text });
    }
  }, [messageToEdit]);

  const submit = async (values: Readonly<CreateUpdateChatMessageReq>) => {
    const optimisticData: ListChatMessagesRes[0] = {
      createdAt: new Date(),
      html: values.text,
      id: crypto.randomUUID()
    };

    await createUpdateMsg(
      values,
      createUpdateOptions({ optimisticData, updatedMsg: messageToEdit })
    );

    clear();
  };

  return (
    <ChatInputForm<CreateUpdateChatMessageReq>
      clear={messageToEdit ? () => clear() : undefined}
      form={form}
      isMutating={isMutating}
      note={
        messageToEdit
          ? 'All messages after the edited message will be removed'
          : undefined
      }
      submit={submit}
      submitLabel={messageToEdit ? 'Update' : 'Send'}
    />
  );
};

type MutationOptions = SWRMutationConfiguration<
  ListChatMessagesRes,
  any,
  string,
  any,
  ListChatMessagesRes
>;

const createUpdateOptions = ({
  optimisticData,
  updatedMsg
}: {
  optimisticData: ListChatMessagesRes[0];
  updatedMsg?: ListChatMessagesRes[0];
}): MutationOptions => {
  const updatedMsgCreatedAt = updatedMsg
    ? new Date(updatedMsg.createdAt)
    : undefined;

  return {
    optimisticData: (msgs = []) => {
      const filteredMsgs = updatedMsgCreatedAt
        ? msgs.filter((msg) => new Date(msg.createdAt) < updatedMsgCreatedAt)
        : msgs;
      return [...filteredMsgs, optimisticData];
    },
    populateCache: (updatedMessages, msgs = []) => {
      const filteredMsgs = updatedMsgCreatedAt
        ? msgs.filter((msg) => new Date(msg.createdAt) < updatedMsgCreatedAt)
        : msgs;
      return [...filteredMsgs, ...updatedMessages];
    },
    revalidate: false,
    rollbackOnError: true
  };
};

interface ChatInputFormProps<T extends BaseChatReq> {
  clear?: () => void;
  form: UseFormReturn<T>; // UseFormReturn with the generic T
  isMutating: boolean;
  note?: string;
  submit: (values: T) => void; // Submit function takes data of type T
  submitLabel?: string;
}

// Generic component definition
const ChatInputForm = <T extends BaseChatReq>({
  clear,
  form,
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
            {clear && (
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
