import { Card, CardHeader, CardTitle } from '@/components/ui/card.js'
import { ListChatsRes } from '@/types/chats'
import { MessageSquare } from 'lucide-react'
import useSWR from 'swr'
import { Link } from 'wouter'


export const ListChats = () => {
    const { data: chats, isLoading } = useSWR<ListChatsRes>(`/p/chats`)

    if (isLoading) {
        return <div>Loading...</div>
    }

    return (
        <div className="grid grid-cols-3 gap-4">
            {chats?.map((c) => (
                <Link key={c.id} to={`/chats/${c.id}`}>
                <Card className="min-h-[100px] p-2" key={c.id}>
                    <CardHeader>
                        <CardTitle className="flex gap-2">
                            <MessageSquare />
                            <div>{c.title}</div>
                        </CardTitle>
                    </CardHeader>
                </Card>
                </Link>
            ))}
        </div>
    )
}
