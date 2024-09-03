import { ListChatMessagesRes } from '@/types/messages';
import { atom } from 'jotai';

export const messageToEditAtom = atom<ListChatMessagesRes[0] | undefined>();
