import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MessageSquare } from 'lucide-react';
import { Link } from 'wouter';

export const NewChatCard = () => {
  return (
    <Card className="border border-transparent hover:border-accent/50 flex items-center justify-center group cursor-pointer">
      <Link
        className="w-full h-full flex items-center justify-center"
        to="/chats/new"
      >
        <Button className="w-10 h-10 rounded-full p-0" variant="ghost">
          <MessageSquare className="p-0 h-6 w-6 text-black/50  group-hover:rotate-12 transition-all duration-300" />
        </Button>
        <div className="px-2">New Chat</div>
      </Link>
    </Card>
  );
};
