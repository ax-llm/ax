import { createReadStream } from 'node:fs';

export interface ApacheTikaArgs {
  url?: string | URL;
}

export interface ApacheTikaConvertOptions {
  format?: 'text' | 'html';
}

export class ApacheTika {
  private tikaUrl: URL;

  constructor(args?: Readonly<ApacheTikaArgs>) {
    const _args = args ?? { url: 'http://localhost:9998/' };
    this.tikaUrl = new URL('/tika', _args.url);
  }

  private async _convert(
    filePath: string,
    options?: Readonly<ApacheTikaConvertOptions>
  ): Promise<string> {
    const fileData = createReadStream(filePath);

    if (!fileData) {
      throw new Error('Failed to read file data');
    }

    const acceptValue = options?.format === 'html' ? 'text/html' : 'text/plain';

    try {
      const res = await fetch(this.tikaUrl, {
        body: fileData as unknown as BodyInit,
        headers: { Accept: acceptValue },
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        duplex: 'half',
        method: 'PUT'
      });

      if (!res.ok) {
        throw new Error(`Failed to upload file: ${res.statusText}`);
      }

      const text = await res.text();
      return text;
    } catch (error) {
      throw new Error(`Error converting file: ${error}`);
    }
  }

  public async convert(
    filePaths: readonly string[],
    options?: Readonly<{ batchSize?: number; format?: 'html' | 'text' }>
  ): Promise<string[]> {
    const results: string[] = [];
    const bs = options?.batchSize ?? 10;

    for (let i = 0; i < filePaths.length; i += bs) {
      const batch = filePaths.slice(i, i + bs);
      const uploadPromises = batch.map((filePath) =>
        this._convert(filePath, { format: options?.format })
      );
      const batchResults = await Promise.all(uploadPromises);
      results.push(...batchResults);
    }

    return results;
  }
}

export default ApacheTika;
