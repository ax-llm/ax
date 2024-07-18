'use client'
import React from "react";


import { sendMessage } from '../actions/index.js';


interface ChatInputProps {
    onUserMessage: (message: Readonly<{id: string, content: string}>) => void;
    onAIMessage: (message: Readonly<{id: string, content: string}>) => void;
}

export const ChatInput = ({ onUserMessage, onAIMessage }: ChatInputProps) => {
    const [text, setText] = React.useState('');

    async function handleSend() {
        const userMsg = {  id: self.crypto.randomUUID(), content: text, }
        onUserMessage(userMsg);
        setText('');

        const aiMsg = await sendMessage(userMsg);
        onAIMessage(aiMsg);
    }

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSend(); }}>
    <div className="bg-gray-100 p-4 flex items-center">
      <input
        type="text"
        className="bg-white p-2 px-3 rounded-full w-full"
        placeholder="Type a message..."
        onChange={(e) => setText(e.target.value)}
        defaultValue={text}
      />
      <button 
      type="submit"
      className="bg-blue-500 text-white p-2 px-4 rounded-full ml-2">
        Send
      </button>
    </div>
    </form>
  );
}
