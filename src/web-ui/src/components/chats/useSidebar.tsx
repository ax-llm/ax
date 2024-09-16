import { atom, useAtom } from 'jotai';

type SidebarItem =
  | {
      agentId: string;
      chatId: string;
      messageIds: string[];
      refChatId: string;
    }
  | { chatId: string };
const sidebarAtom = atom<SidebarItem[]>([]);

export const useSidebar = () => {
  const [sidebarItems, setSidebarItems] = useAtom(sidebarAtom);

  const addChat = (item: SidebarItem) => {
    setSidebarItems((prev) => {
      if (!prev.some((v) => v.chatId === item.chatId)) {
        return [...prev, item];
      }
      return prev;
    });
  };

  const removeChat = (chatId: string) => {
    setSidebarItems((prev) => prev.filter((item) => item.chatId !== chatId));
  };

  const isChatInSidebar = (chatId: string) => {
    return sidebarItems.some((item) => item.chatId === chatId);
  };

  const replaceChat = (chatId: string, newItem: SidebarItem) => {
    setSidebarItems((prev) =>
      prev.map((item) => (item.chatId === chatId ? newItem : item))
    );
  };

  return {
    addChat,
    isChatInSidebar,
    removeChat,
    replaceChat,
    sidebarItems
  };
};

export const isChatNew = (item: SidebarItem) => {
  return (
    'agentId' in item &&
    'messageIds' in item &&
    'chatId' in item &&
    'refChatId' in item
  );
};

//   const addMessageToChat = (chatId: string, messageId: string) => {
//     setSidebarItems((prev) =>
//       prev.map((item) =>
//         item.chatId === chatId
//           ? { ...item, messagesIds: [...item.messagesIds, messageId] }
//           : item
//       )
//     );
//   };
