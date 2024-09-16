import { Button } from '@/components/ui/button.js';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet.js';
import { AtSign } from 'lucide-react';

import { AgentAvatar } from './AgentCard.js';
import { useAgentList } from './useAgentList.js';

export const AgentSheet = () => {
  const { agents } = useAgentList();

  return (
    <div>
      <Sheet modal={false}>
        <SheetTrigger asChild>
          <Button size="xs" variant="outline">
            <AtSign className="inline-block mr-2" size={15} />
            Mention
          </Button>
        </SheetTrigger>

        <SheetContent>
          <SheetHeader>
            <SheetTitle>Select Agents</SheetTitle>
            <SheetClose />
          </SheetHeader>

          <ul className="space-y-3">
            {agents?.map((agent) => (
              <li
                className="bg-white rounded-lg p-3 shadow hover:shadow-lg transition-shadow duration-300 ease-in-out"
                key={agent.id}
              >
                <div className="flex items-center space-x-4">
                  <AgentAvatar value={agent?.name} />
                  <div>
                    <h3 className="font-semibold text-purple-800">
                      {agent.name}
                    </h3>
                    <p className="text-sm text-gray-600">
                      {agent.description || 'No description available.'}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default AgentSheet;
