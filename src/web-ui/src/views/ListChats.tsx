// import Title from '@/components/Title';
import { ChatCard } from '@/components/chats/ChatCard';
// import { NewChatCard } from '@/components/chats/NewChatCard';
import { useChatList } from '@/components/chats/useChatList';
import { Link } from 'wouter';

export const ListChats = () => {
  const { chats, isLoading } = useChatList();

  if (isLoading || !chats) {
    return [];
  }

  return chats.map((chat) => (
    <Link key={chat.id} to={`/chats/${chat.id}`}>
      <ChatCard chat={chat} key={chat.id} />
    </Link>
  ));

  //   return (
  //     <div>
  //       <Title size="sm">Latest chats</Title>
  //       <div className="grid grid-cols-1 md:grid-cols-4 uto-rows-fr gap-4">
  //         <NewChatCard />
  //         {chats?.map((chat) => (
  //           <Link key={chat.id} to={`/chats/${chat.id}`}>
  //             <ChatCard chat={chat} key={chat.id} />
  //           </Link>
  //         ))}
  //       </div>
  //     </div>
  //   );
};
