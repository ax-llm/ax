import http from 'http';

import chalk from 'chalk';
import httpProxy from 'http-proxy';

import { RemoteLogger } from '../logs/remote.js';

import { MemoryCache } from './cache.js';
import { addHandlers, errMsg, requestHandler } from './handlers.js';
import { CacheItem } from './types.js';

const cache = new MemoryCache<CacheItem>();

export class LLMProxy {
  private proxy: httpProxy;
  private debug: boolean;
  private port: number;

  constructor(port = 8081, debug = false) {
    this.port = port;
    this.debug = debug;
    this.proxy = httpProxy.createProxyServer({
      secure: false,
      prependPath: true,
      changeOrigin: true
    });
    addHandlers(this.proxy, cache, this.debug);
  }

  start() {
    http
      .createServer((req, res) => {
        try {
          requestHandler(this.proxy, cache, this.debug, req, res);
        } catch (err: unknown) {
          errMsg(res, (err as Error).message);
        }
      })
      .listen(this.port, () => {
        const msg = `🌵 LLMClient caching proxy listening on port ${this.port}`;
        const remoteLog = new RemoteLogger();

        console.log(chalk.greenBright(msg));
        remoteLog.printDebugInfo();
        console.log('🔥 ❤️  🖖🏼');
      });
  }
}
