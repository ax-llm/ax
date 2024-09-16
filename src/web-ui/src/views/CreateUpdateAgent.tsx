import type { GetAgentRes } from '@ax-llm/web-api/src/types/agents.js';

import { ExtendedButton } from '@/components/ExtendedButton.js';
import { TextInput } from '@/components/TextInput.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card.js';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form.js';
import { Input } from '@/components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select.js';
// import { useToast } from '../components/ui/use-toast.js'
import { postFetch } from '@/lib/fetchers.js';
import {
  type CreateUpdateAgentReq,
  type GetAIListRes,
  createUpdateAgentReq
} from '@/types/agents.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import useSWR, { useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';
import { useParams } from 'wouter';

const CreateUpdateAgent = () => {
  const { agentId } = useParams<{ agentId: string }>();

  const [showBigModelChooser, setShowBigModelChooser] = useState(false);
  const [showSmallModelChooser, setShowSmallModelChooser] = useState(false);

  // const { toast } = useToast()
  const { mutate } = useSWRConfig();

  const { data: aiList } = useSWR<GetAIListRes>(`/p/ai`);

  const { data: agent, isLoading } = useSWR<GetAgentRes>(
    agentId ? `/a/agents/${agentId}` : null
  );

  const { isMutating, trigger: createUpdateAgent } = useSWRMutation(
    agentId ? `/a/agents/${agentId}` : `/a/agents`,
    postFetch<CreateUpdateAgentReq, { id: string }>,
    {}
  );

  const form = useForm<CreateUpdateAgentReq>({
    defaultValues: {
      aiBigModel: {
        apiKey: ''
      },
      aiSmallModel: {
        apiKey: ''
      },
      description: '',
      name: ''
    },
    mode: 'all',
    resolver: zodResolver(createUpdateAgentReq)
  });

  useEffect(() => {
    if (!agent) return;
    form.reset({
      aiBigModel: {
        apiKey: agent.aiBigModel.apiKeyId ? 'set' : '',
        id: agent.aiBigModel.id,
        model: agent.aiBigModel.model
      },
      aiSmallModel: {
        apiKey: agent.aiSmallModel.apiKeyId ? 'set' : '',
        id: agent.aiSmallModel.id,
        model: agent.aiSmallModel.model
      },
      description: agent.description,
      name: agent.name
    });
  }, [agent]);

  const aiBigModelId = useWatch({
    control: form.control,
    name: 'aiBigModel.id'
  });

  const aiSmallModelId = useWatch({
    control: form.control,
    name: 'aiSmallModel.id'
  });

  useEffect(() => {
    setShowBigModelChooser(aiBigModelId !== undefined);
    setShowSmallModelChooser(aiSmallModelId !== undefined);
  }, [aiBigModelId, aiSmallModelId]);

  useEffect(() => {
    setShowBigModelChooser(agent?.aiBigModel.id !== undefined);
    setShowSmallModelChooser(agent?.aiSmallModel.id !== undefined);
  }, [agent]);

  //   const { append: memberAppend, fields: memberFields, remove: memberRemove } = useFieldArray({
  //     control: form.control,
  //     keyName: 'email',
  //     name: 'members',
  //   })

  const submit = async (values: Readonly<CreateUpdateAgentReq>) => {
    const { id } = await createUpdateAgent(values);
    await mutate(`/a/agents/${id}`);
    // toast({
    //   description: 'Your team changes have been saved',
    //   title: 'Team Saved'
    // })
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-3">
      <Card className="sticky top-0 bg-white z-10">
        <CardHeader>
          <CardTitle className="text-xl">Setup Your Agent</CardTitle>
          <CardDescription>
            Invite your team members to collaborate. Keep in mind invited
            members will have access to everything within this team.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 bg-stone-100 bg-opacity-50 p-3">
          <div className="flex items-center gap-3 w-full">
            <ExtendedButton
              // disabled={!form.formState.isDirty}
              isLoading={isMutating}
              label="Save Changes"
              loadingLabel="Saving..."
              onClick={form.handleSubmit(submit)}
            />
            {form.formState.isDirty && (
              <div className="text-sm text-red-500">Save your changes</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Form {...form}>
        <Card>
          <CardContent className="space-y-4 w-full lg:w-8/12">
            <FormField
              control={form.control}
              name={'name'}
              render={({ field }) => (
                <FormItem>
                  <FormLabel> Name</FormLabel>
                  <FormDescription>
                    Choose a name for your agent. This is required
                  </FormDescription>
                  <FormControl>
                    <Input placeholder="Example Agent" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name={'description'}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormDescription>
                    Describe your agent. This is optional.
                  </FormDescription>
                  <FormControl>
                    <TextInput
                      className="border"
                      maxLength={2000}
                      placeholder="Enter a description"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 w-full lg:w-8/12">
            <FormField
              control={form.control}
              name={'aiBigModel.id'}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Big LLM Model</FormLabel>
                  <FormDescription>
                    Pick the big model you want to use for your agent.
                  </FormDescription>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an AI" />
                      </SelectTrigger>
                    </FormControl>

                    <SelectContent>
                      {aiList?.map((ai) => (
                        <SelectItem key={ai.id} value={ai.id}>
                          {ai.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {showBigModelChooser && (
              <FormField
                control={form.control}
                name={'aiBigModel.model'}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <FormDescription>
                      Pick the model you want to use for your agent.
                    </FormDescription>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a model" />
                        </SelectTrigger>
                      </FormControl>

                      <SelectContent>
                        {aiList
                          ?.find(
                            (v) => v.id === form.getValues('aiBigModel.id')
                          )
                          ?.models.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.id} ({m.inputTokenPrice} / {m.outputTokenPrice}
                              )
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {showBigModelChooser && (
              <FormField
                control={form.control}
                name={'aiBigModel.apiKey'}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Key</FormLabel>
                    <FormDescription>
                      Enter your API key for the AI you selected.
                    </FormDescription>
                    <div className="flex flex-wrap items-center gap-2">
                      <FormControl>
                        <Input
                          className="border"
                          placeholder="Enter your API key"
                          type="password"
                          {...field}
                        />
                      </FormControl>
                      {agent?.aiBigModel.apiKeyId && (
                        <APIKeyId apiKeyId={agent.aiBigModel.apiKeyId} />
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 w-full lg:w-8/12">
            <FormField
              control={form.control}
              name={'aiSmallModel.id'}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Small LLM Model</FormLabel>
                  <FormDescription>
                    Pick the small model you want to use for your agent.
                  </FormDescription>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an AI" />
                      </SelectTrigger>
                    </FormControl>

                    <SelectContent>
                      {aiList?.map((ai) => (
                        <SelectItem key={ai.id} value={ai.id}>
                          {ai.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {showSmallModelChooser && (
              <FormField
                control={form.control}
                name={'aiSmallModel.model'}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <FormDescription>
                      Pick the model you want to use for your agent.
                    </FormDescription>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a model" />
                        </SelectTrigger>
                      </FormControl>

                      <SelectContent>
                        {aiList
                          ?.find(
                            (v) => v.id === form.getValues('aiSmallModel.id')
                          )
                          ?.models.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.id} ({m.inputTokenPrice} / {m.outputTokenPrice}
                              )
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {showSmallModelChooser && (
              <FormField
                control={form.control}
                name={'aiSmallModel.apiKey'}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Key</FormLabel>
                    <FormDescription>
                      Enter your API key for the AI you selected.
                    </FormDescription>
                    <div className="flex flex-wrap items-center gap-2">
                      <FormControl>
                        <Input
                          className="border"
                          placeholder="Enter your API key"
                          type="password"
                          {...field}
                        />
                      </FormControl>
                      {agent?.aiSmallModel.apiKeyId && (
                        <APIKeyId apiKeyId={agent.aiSmallModel.apiKeyId} />
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </CardContent>
        </Card>
      </Form>
    </div>
  );
};

const APIKeyId = ({ apiKeyId }: { apiKeyId: string }) => {
  return (
    <div className="text-sm bg-gray-50 w-[300px] p-1 px-2 rounded-md">
      <div className="text-xs">Key starts with:</div>
      <div className="font-medium">{apiKeyId}</div>
    </div>
  );
};

export default CreateUpdateAgent;
