import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger
} from '@/components/ui/hover-card';
import { GetAgentRes } from '@/types/agents.js';
import { BrainCircuitIcon } from 'lucide-react';
import { useState } from 'react';

import { AgentAvatar } from './AgentCard.js';
import { useAgentShow } from './useAgentList.js';

interface AgentHoverCardProps {
  agent: { id: string; name: string };
  size?: 'lg' | 'md' | 'sm' | 'xl';
}

export function AgentHoverCard({ agent, size }: AgentHoverCardProps) {
  const [open, setOpen] = useState(false);
  const { agent: data, isLoading } = useAgentShow(open ? agent.id : null);

  const sizeValue = {
    lg: 30,
    md: 25,
    sm: 20,
    xl: 40
  }[size ?? 'lg'];

  return (
    <HoverCard onOpenChange={(isOpen) => setOpen(isOpen)} openDelay={100}>
      <HoverCardTrigger asChild>
        <div className="cursor-pointer">
          <AgentAvatar size={sizeValue} value={agent?.name} />
        </div>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 space-y-2 p-0 bg-white">
        {isLoading ? <div>Loading...</div> : data && <AgentInfo agent={data} />}
      </HoverCardContent>
    </HoverCard>
  );
}

export const AgentInfo = ({ agent }: { agent: GetAgentRes }) => {
  return (
    <div className="w-full max-w-md border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 p-4 flex items-center gap-2">
        <AgentAvatar value={agent.name} />
        <div>
          <h3 className="text-xl font-bold">{agent.name}</h3>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {agent.description && (
          <p className="text-sm text-gray-700">{agent.description}</p>
        )}
        <div className="space-y-2 text-sm">
          <div className="flex items-start gap-2">
            <BrainCircuitIcon className="w-4 h-4 text-gray-500" />
            <div>
              <div>Big Model:</div>
              <div>
                {agent.aiBigModel.id} - {agent.aiBigModel.model}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <BrainCircuitIcon className="w-4 h-4 text-gray-500" />
            <div>
              <div>Small Model:</div>
              <div>
                {agent.aiSmallModel.id} - {agent.aiSmallModel.model}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
