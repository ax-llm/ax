import { atom, useAtom } from 'jotai';

import { Messages } from './types.js';

// Define the type for selected messages which can be a single message or an array
type SelectedMessagesType = Messages;

// Create an atom that stores a map of chatIds to selected messages
export const selectedMessagesAtom = atom<Map<string, SelectedMessagesType>>(
  new Map()
);

// Custom hook to use the selectedMessagesAtom
export function useSelectedMessages() {
  const [selectedMessagesMap, setSelectedMessagesMap] =
    useAtom(selectedMessagesAtom);

  // Function to set selected messages for a specific chatId
  const setSelectedMessages = (
    chatId: string,
    messages: SelectedMessagesType | undefined
  ) => {
    setSelectedMessagesMap((prevMap) => {
      const newMap = new Map(prevMap);
      if (messages === undefined) {
        newMap.delete(chatId);
      } else {
        newMap.set(chatId, messages);
      }
      return newMap;
    });
  };

  const clearSelectedMessages = (chatId: string) => {
    setSelectedMessagesMap((prevMap) => {
      const newMap = new Map(prevMap);
      newMap.delete(chatId);
      return newMap;
    });
  };

  // Function to get selected messages for a specific chatId
  const getSelectedMessages = (
    chatId: string
  ): SelectedMessagesType | undefined => {
    return selectedMessagesMap.get(chatId);
  };

  return { getSelectedMessages, selectedMessagesMap, setSelectedMessages };
}
