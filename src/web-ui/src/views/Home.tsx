import { Banner } from '@/components/Banner.js';
import { CardFlow } from '@/components/CardFlow.js';

import { ListAgents } from './ListAgents.js';
import { ListChats } from './ListChats.js';

export const Home = () => {
  return (
    <div className="mt-4">
      <CardFlow effect="roman">
        <Banner />
        <ListAgents />
        {...ListChats()}
      </CardFlow>
    </div>
  );
};
