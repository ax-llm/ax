import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';
import { Plus } from 'lucide-react';
import { Link } from 'wouter';

export const NewAgentCard = () => {
  return (
    <Card className="border border-transparent hover:border-accent/50 p-2 flex items-center justify-center group cursor-pointer">
      <Link
        className="w-full h-full flex items-center justify-center"
        to="/agents/new"
      >
        <Button className="w-10 h-10 rounded-full p-0" variant="ghost">
          <Plus className="p-0 h-6 w-6 text-black/50 group-hover:rotate-90 transition-all duration-300" />
        </Button>
        <div className="px-2">Add Agent</div>
      </Link>
    </Card>
  );
};
