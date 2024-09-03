
import { GetAgentRes } from "@/types/agents"
import { BotMessageSquare } from "lucide-react"
import useSWR from "swr"

interface AgentCardProps {
    agentId: string
}

export const AgentCard = ({ agentId } : Readonly<AgentCardProps>) => {
    const { data: agent, isLoading } = useSWR<GetAgentRes>(agentId ? `/p/agents/${agentId}` : null)

    if (isLoading) {
        return <div>Loading...</div>
    }

    return (
    <div className="flex items-center gap-2 px-4">
        <div className="rounded-full p-2 bg-lime-200">
            <BotMessageSquare size={30}  />
        </div>
        <div>
            <h1 className="text-md font-bold">
                {agent?.name ?? ""}
            </h1>
            <p className="text-sm text-gray-500">
                {agent?.description ?? ""}
            </p>
        </div>
    </div>
    )
}