'use client'

import { useState } from 'react';

import { ChatInput } from './ChatInput.js';
import { ChatMessage, Message, User } from './ChatMessage.js';

const defaultMessages : Message[]= [
    {
        id: "1",
        userId: "user-1",
        content: "Soapbox Derby Planning Demo Board",
        at: "2024-07-16T09:27:00.000Z",
      },
      {
        id: "2",
        userId: "ai-1",
        content: "Is everything all set for the derby next Saturday?",
        at: "2024-07-16T09:30:00.000Z",
      },
      {
        id: "3",
        userId: "user-1",
        content: "Almost, we still need to confirm the number of participants and finalize the race brackets.",
        at: "2024-07-16T09:32:00.000Z",
    },
    {
        id: "4",
        userId: "ai-1",
        content: "Would you like me to send a reminder to the participants who haven’t confirmed yet?",
        at: "2024-07-16T09:34:00.000Z",
    },
    {
        id: "5",
        userId: "user-1",
        content: "Yes, please send out the reminder. Also, can you check if the trophy order has been confirmed?",
        at: "2024-07-16T09:36:00.000Z",
    },
    {
        id: "6",
        userId: "ai-1",
        content: "Reminder sent! I've also checked the status of the trophy order—it's confirmed and scheduled for delivery on Thursday.",
        at: "2024-07-16T09:37:00.000Z",
    },
    {
        id: "7",
        userId: "user-1",
        content: "Great! Can you compile a list of all tasks that still need attention?",
        at: "2024-07-16T09:40:00.000Z",
    },
    {
        id: "8",
        userId: "ai-1",
        content: "Sure thing. Here’s what needs to be done: 1. Finalize the event schedule. 2. Arrange for additional seating. 3. Confirm the food vendors.",
        at: "2024-07-16T09:42:00.000Z",
    }
];

const users : User[] = [
    {
        id: "user-1",
        name: "Phil",
        avatar: "https://robohash.org/phil",
        type: "user",
    },
    {
        id: "ai-1",
        name: "Antonio",
        avatar: "https://robohash.org/antonio",
        type: "ai",
    }
];


export const Chat = () => {
    const [messages, setMessages] = useState<Message[]>(defaultMessages);

  return (
    <div className="bg-white h-screen">
      <div className="space-y-4 p-6 pb-52">
        {messages.map(msg => (
          <ChatMessage 
            key={msg.id} 
            message={msg} 
            user={users.find(u => u.id === msg.userId) as User} 
          />
        ))}
      </div>
      <div className="fixed bottom-0 w-full">
        <ChatInput 
        onUserMessage={(msg) => {
            setMessages((m) => [...m, { ...msg, userId: "user-1", at: new Date() }]);
        }}
        onAIMessage={(msg) => {
            setMessages((m) => [...m, { ...msg, userId: "ai-1", at: new Date() }]);
        }}
        />
      </div>
    </div>
  );
}