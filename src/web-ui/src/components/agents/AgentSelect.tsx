import { Button, ButtonProps } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';

import { AgentAvatar } from './AgentCard.js';
import { useAgentList } from './useAgentList.js';

interface AgentSelectProps extends Pick<ButtonProps, 'size' | 'variant'> {
  label: React.ReactNode | string;
  onSelect?: (agentId: string) => void;
  selected?: string[];
}

export const AgentSelect = ({
  label,
  onSelect,
  selected,
  size = 'xs',
  variant = 'outline'
}: AgentSelectProps) => {
  const { agents } = useAgentList();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size={size} variant={variant}>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-40">
        <div className="grid gap-4">
          {agents
            ?.filter((agent) => !selected?.includes(agent.id))
            ?.map((agent) => (
              <div
                className="flex items-center space-x-2"
                key={agent.id}
                onClick={() => onSelect?.(agent.id)}
              >
                <AgentAvatar value={agent.name} />
                <Label>{agent.name}</Label>
              </div>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
