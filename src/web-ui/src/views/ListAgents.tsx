// import Title from '@/components/Title';
// import { AddAgentCard } from '@/components/agents/AddAgentCard';
import { AgentCard } from '@/components/agents/AgentCard';
import { NewAgentCard } from '@/components/agents/NewAgentCard';
import { useAgentList } from '@/components/agents/useAgentList';
import { CardContent } from '@/components/ui/card';
import { ChevronRight } from 'lucide-react';
import { Link } from 'wouter';

export const ListAgents = () => {
  const { agents, isLoading } = useAgentList();

  if (isLoading || !agents) {
    return null;
  }

  return (
    <CardContent>
      <div className="flex flex-col space-y-4">
        <div className="flex items-center pb-2 text-primary">
          <ChevronRight /> Pick an agent to chat with
        </div>
        {agents.map((agent) => (
          <Link key={agent.id} to={`/agents/${agent.id}/chat`}>
            <AgentCard agent={agent} key={agent.id} showEditButton={true} />
          </Link>
        ))}
        <NewAgentCard />
      </div>
    </CardContent>
  );

  //   return (
  //     <div>
  //       <Title size="sm">Agents</Title>
  //       <div className="shadow bg-background p-2flex auto-rows-fr gap-2">
  //         {agents?.map((agent) => (
  //           <Link key={agent.id} to={`/chats/new?agentId=${agent.id}`}>
  //             <AgentCard agent={agent} key={agent.id} showEditButton={true} />
  //           </Link>
  //         ))}
  //         <AddAgentCard />
  //       </div>
  //     </div>
  //   );
};
