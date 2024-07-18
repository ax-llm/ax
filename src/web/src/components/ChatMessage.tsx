import { formatFriendlyDate } from '../util.js';

export interface Message {
    id: string;
    userId: string;
    content: string;
    at: string | Date;
}

export interface User {
    id: string;
    name: string;
    avatar?: string;
    type: 'user' | 'ai';
}

export const ChatMessage = ({ message, user } : Readonly<{ message: Message, user: User }>)  => {
    const isUser = user.type === "user"
    const messageClasses = isUser ? "bg-blue-500 text-white" : "bg-gray-300 text-black";
    const alignmentClasses = isUser ? "justify-end" : "justify-start";
    const bubbleTail = isUser ? "bubble-tail-right" : "bubble-tail-left";
  
    return (
      <div className={`flex ${alignmentClasses} mb-4`}>
        {!isUser && <img src={user.avatar} alt="avatar" className="w-12 h-12 rounded-full mr-2" />}
        <div className={`rounded-lg p-4 max-w-xs lg:max-w-md ${messageClasses}`}>
          <div className={bubbleTail}></div>
          <strong>{user.name}</strong>
          <p>{message.content}</p>
          <div className={`text-right text-xs ${isUser ? 'text-white' : 'text-gray-600'}`}>
            {formatFriendlyDate(message.at)}
          </div>
        </div>
        {isUser && <img src={user.avatar} alt="avatar" className="w-8 h-8 rounded-full ml-2" />}
      </div>
    );
  }
