import superagent from 'superagent';

export class Spider {
  concurrent = 5;
  delay = 0; // in ms
  depth: number;
  domains: string[];
  queue: { url: string; depth: number }[] = [];
  visited: { [url: string]: boolean } = {};
  defaultDomain: string;

  constructor(
    private readonly startPage: string,
    private readonly handleRequest: (
      url: string,
      data: string,
      depth: number
    ) => void,
    config: Readonly<{ depth: number; domains: string[] }>
  ) {
    this.depth = config.depth;
    this.domains = config.domains;
    this.defaultDomain = new URL(startPage).hostname;
    this.queue.push({ url: this.startPage, depth: 1 });
  }

  async crawl() {
    while (this.queue.length > 0) {
      const value = this.queue.shift();
      if (!value) {
        break;
      }
      // eslint-disable-next-line prefer-const
      let { url, depth } = value;

      if (url.indexOf('://') === -1) {
        url = new URL(url, this.startPage).href;
      }

      if (depth > this.depth) {
        continue;
      }

      if (this.domains.length > 0) {
        const parsedUrl = new URL(url);

        if (this.domains.indexOf(parsedUrl.hostname) == -1) {
          continue;
        }
      }
      if (!this.visited[url]) {
        this.visited[url] = true;
        try {
          const res = await superagent.get(url);
          if (res.status !== 200 || res.type !== 'text/html') {
            continue;
          }
          this.handleRequest(url, res.text, depth + 1);
        } catch (e) {
          console.error(e);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    }
    console.log('Done!');
  }

  queueUrl(url: string, depth: number) {
    this.queue.push({ url, depth });
  }
}
