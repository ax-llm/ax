import { parserMap } from './parsers';
import { ExtendedIncomingMessage } from './types';

export const extendRequest = (
  // eslint-disable-next-line functional/prefer-immutable-types
  req: ExtendedIncomingMessage
): string => {
  if (!req.url) {
    throw new Error('No URL provided');
  }

  let providerName = (
    req.headers['x-llm-provider'] as string | undefined
  )?.toLocaleLowerCase();

  let urlPath = req.url as string | undefined;

  if (!providerName) {
    const parts = req.url.split('/')?.slice(1);
    providerName = parts.shift()?.toLocaleLowerCase();
    urlPath = '/' + parts.join('/');
  }

  if (!providerName || providerName === '') {
    throw new Error('No LLM provider defined');
  }

  const pm = parserMap.get(providerName);
  if (!pm) {
    throw new Error(`Unknown LLM provider: ${providerName}`);
  }

  const parser = pm.parsers.find((p) => urlPath?.startsWith(p.path))?.parser;
  if (!parser) {
    throw new Error(`Unknown LLM provider path: ${urlPath}`);
  }

  req.startTime = Date.now();
  req.url = urlPath;
  req.parser = parser;

  if (pm.target instanceof Function) {
    if (!req.host && pm.hostRequired) {
      throw new Error('No host provided (x-llmclient-host');
    }
    return pm.target(req.host);
  }

  return pm.target;
};
