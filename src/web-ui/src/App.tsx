import { Suspense, lazy } from 'react';
import { SWRConfig } from 'swr';
import { Redirect, Route, Router, Switch } from 'wouter';

import { Layout } from './components/Layout.js';
import { Protected } from './components/Protected.js';
import { getFetch } from './lib/fetchers.js';
import { CreateChat } from './views/CreateChat.js';
import { Home } from './views/Home.js';
import { ListAgents } from './views/ListAgents.js';
import { UpdateChat } from './views/UpdateChat.js';

const CreateUpdateAgent = lazy(
  async () => await import('./views/CreateUpdateAgent.js')
);

export const App = () => {
  const routes = (
    <Switch>
      <Route component={Home} path="/" />
      <Route component={ListAgents} path="/agents" />
      <Route component={CreateUpdateAgent} path="/agents/new" />
      <Route component={CreateUpdateAgent} path="/agents/:agentId" />
      <Route component={CreateChat} path="/agents/:agentId/chat" />
      <Route component={UpdateChat} path="/chats/:chatId" />
    </Switch>
  );

  return (
    <SWRConfig
      value={{
        fetcher: getFetch,
        refreshInterval: 900000,
        revalidateOnFocus: false,
        revalidateOnReconnect: false
      }}
    >
      <Router>
        <Protected>
          <Layout>
            <Suspense fallback={<div>Loading...</div>}>{routes}</Suspense>
          </Layout>
        </Protected>
      </Router>
    </SWRConfig>
  );
};
