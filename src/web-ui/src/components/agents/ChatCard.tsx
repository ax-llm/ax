
import { GetChatRes } from "@/types/chats"
import useSWR from "swr"

import { AgentHoverCard } from './AgentHoverCard.js'

interface ChatCardProps {
    chatId?: string
}

export const ChatCard = ({ chatId } : Readonly<ChatCardProps>) => {
    const { data: chat } = useSWR<GetChatRes>(chatId ? `/p/chats/${chatId}` : null)
    
    if (!chat) {
        return null
    }
    return (
    <div className="flex items-center gap-2 px-4 py-1">
        <div>
            <h1 className="text-md font-bold">
                {chat.title}
            </h1>
        </div>
        <AgentHoverCard agent={chat.agent} />
    </div>
    )
}