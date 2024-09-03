import { ListAgents } from './ListAgents.js';
import { ListChats } from './ListChats.js';

export const Home = () => {
  return (
    <div className="space-y-10 mt-5">
      <ListAgents />
      <ListChats />
    </div>
  );
};
