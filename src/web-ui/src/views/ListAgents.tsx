import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card.js';
import { ListAgentsRes } from '@/types/agents';
import { BotMessageSquare } from 'lucide-react';
import useSWR from 'swr';
import { Link } from 'wouter';

export const ListAgents = () => {
  const { data: agents, isLoading } = useSWR<ListAgentsRes>(`/p/agents`);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      {agents?.map((a) => (
        <Link key={a.id} to={`/chats/new?agentId=${a.id}`}>
          <Card className="min-h-[100px] p-2" key={a.id}>
            <CardHeader>
              <CardTitle className="flex gap-2">
                <BotMessageSquare />
                <div>{a.name}</div>
              </CardTitle>
            </CardHeader>
            {a.description && (
              <CardContent>
                <CardDescription>{a.description}</CardDescription>
              </CardContent>
            )}
          </Card>
        </Link>
      ))}
    </div>
  );
};
