import {
  Avatar,
} from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { GetChatRes } from "@/types/chats"
import { BotMessageSquare } from "lucide-react"

interface AgentHoverCardProps {
    agent: GetChatRes["agent"]
}
 
export function AgentHoverCard({ agent }: AgentHoverCardProps) {
  return (
    <HoverCard openDelay={100}>
      <HoverCardTrigger asChild>
        <div className="rounded-full p-2 bg-lime-200 cursor-pointer">
            <BotMessageSquare size={20} />
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 space-y-2 p-0">
        <div className="flex gap-2 items-center font-medium border-b border-gray-100 p-4">
            <BotMessageSquare size={20} />
            Agent
        </div>
        <div className="p-4 pt-0">
            <h4 className="text-md font-semibold">{agent.name}</h4>
            <p className="text-sm">{agent.description}</p>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}