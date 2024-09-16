import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';
import { Plus } from 'lucide-react';
import { Link } from 'wouter';

export const NewAgentCard = () => {
  return (
    <Card className="p-2 flex items-center justify-center group cursor-pointer shadow-none border">
      <Link
        className="h-full flex items-center justify-center"
        to="/agents/new"
      >
        <Button className="rounded-full p-0" variant="ghost">
          <Plus className="p-0 h-6 w-6 text-black/50 group-hover:rotate-90 transition-all duration-300" />
        </Button>
        <div className="px-2">Add Agent</div>
      </Link>
    </Card>
  );
};
