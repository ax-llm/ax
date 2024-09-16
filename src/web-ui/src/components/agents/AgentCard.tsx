import { Button } from '@/components/ui/button.js';
import { GetAgentRes, ListAgentsRes } from '@/types/agents';
import Avatar from 'avvvatars-react';
import { Settings2 } from 'lucide-react';
import { Link } from 'wouter';

import { AgentHoverCard } from './AgentHoverCard.js';

interface AgentCardProps {
  agent: GetAgentRes | ListAgentsRes[0];
  showEditButton?: boolean;
}

export const AgentCard = ({
  agent,
  showEditButton
}: Readonly<AgentCardProps>) => {
  return (
    <div className="flex justify-between items-center gap-2">
      <div className="flex items-center gap-2 text-lg font-medium">
        <AgentHoverCard agent={agent} size="xl" />
        <div>{agent.name}</div>
      </div>

      {showEditButton && (
        <Link to={`/agents/${agent.id}`}>
          <Button variant="ghost">
            <Settings2 size={20} />
          </Button>
        </Link>
      )}
    </div>
  );
};

interface AgentAvatarProps {
  size?: number;
  value: string;
}

export const AgentAvatar = ({ size = 40, value }: AgentAvatarProps) => (
  <Avatar
    border={true}
    borderColor="#ddd"
    borderSize={1}
    size={size}
    style="shape"
    value={value}
  />
);
