import type { StreamMsgIn, StreamMsgOut } from '@/types/stream.js';
import type { Context } from 'hono';
import type {
  UpgradeWebSocket,
  WSContext,
  WSEvents,
  WSMessageReceive
} from 'hono/ws';

const clients = new Map<string, Set<WSContext>>();

const onOpen = (_evt: Event, ws: WSContext) => {
  console.log('Connection opened');
  ws.send(JSON.stringify({ type: 'connected' }));
};

const onClose = (_evt: Event, ws: WSContext) => {
  console.log('Connection closed');
  clients.forEach((wsSet, chatId) => {
    if (wsSet.has(ws)) {
      wsSet.delete(ws);
      if (wsSet.size === 0) {
        clients.delete(chatId);
      }
    }
  });
};

const onError = (evt: Event, _ws: WSContext) => {
  console.error('WebSocket error:', evt);
};

const onMessage = (event: { data: WSMessageReceive }, ws: WSContext) => {
  //   console.log('Message received:', event.data);

  let message: StreamMsgIn | undefined;

  try {
    message = JSON.parse(event.data.toString());
  } catch (error) {
    console.error('Failed to parse message:' + event.data);
  }

  switch (message?.msgType) {
    case 'registerChatClient':
      register(message, ws);
      break;
    default:
      console.log('Unknown message type:', message?.msgType);
  }
};

export const createChatWebSocketHandler: Parameters<UpgradeWebSocket>[0] =
  async (_c: Context): Promise<WSEvents> => ({
    onClose,
    onError,
    onMessage,
    onOpen
  });

// Function to send a message to all WebSockets associated with a chatId
export const sendMessages = (chatId: string, message: StreamMsgOut) => {
  const wsSet = clients.get(chatId);
  //   console.log(`Sending message to chatId: ${chatId}`);
  if (wsSet) {
    // console.log(
    //   `Found ${wsSet.size} WebSocket connections for chatId: ${chatId}`
    // );
    const msg = JSON.stringify(message);
    wsSet.forEach((ws) => ws.send(msg));
  }

  //   else {
  //     console.log(`No WebSocket connections found for chatId: ${chatId}`);
  //   }
};

const register = ({ chatId }: { chatId: string }, ws: WSContext) => {
  if (chatId) {
    // Get or create a Set of WebSocket connections for this chatId
    if (!clients.has(chatId)) {
      clients.set(chatId, new Set());
    }
    clients.get(chatId)!.add(ws);
    ws.send(JSON.stringify({ msgType: 'clientRegistered' }));
  } else {
    // console.log('Message received without a chatId:');
  }
};
