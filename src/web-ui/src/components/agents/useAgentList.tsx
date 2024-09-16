import { GetAgentRes, ListAgentsRes } from '@/types/agents';
import useSWR from 'swr';

export const useAgentList = () => {
  const { data, isLoading } = useSWR<ListAgentsRes>(`/a/agents`);

  return {
    agents: data,
    isLoading
  };
};

export const useAgentShow = (agentId: null | string) => {
  const { data, isLoading } = useSWR<GetAgentRes>(
    agentId ? `/a/agents/${agentId}` : null
  );

  return {
    agent: data,
    isLoading
  };
};
