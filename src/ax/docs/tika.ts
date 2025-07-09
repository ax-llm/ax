// Dynamic import for Node.js-specific functionality to maintain browser compatibility

export interface AxApacheTikaArgs {
  url?: string | URL;
  fetch?: typeof fetch;
}

export interface AxApacheTikaConvertOptions {
  format?: 'text' | 'html';
}

export class AxApacheTika {
  private tikaUrl: URL;
  private fetch?: typeof fetch;

  constructor(args?: Readonly<AxApacheTikaArgs>) {
    const Args = args ?? { url: 'http://localhost:9998/' };
    this.tikaUrl = new URL('/tika', Args.url);
    this.fetch = Args.fetch;
  }

  private async _convert(
    file: string | Blob,
    options?: Readonly<AxApacheTikaConvertOptions>
  ): Promise<string> {
    let fileData: ReadableStream | Blob;

    if (typeof file === 'string') {
      // In Node.js environment, dynamically import fs
      if (typeof window === 'undefined' && typeof process !== 'undefined') {
        try {
          const fs = await import('node:fs');
          fileData = fs.createReadStream(file) as any;
        } catch {
          throw new Error(
            'File path input is only supported in Node.js environments'
          );
        }
      } else {
        throw new Error(
          'File path input is only supported in Node.js environments. Use Blob in browser.'
        );
      }
    } else {
      fileData = file;
    }

    if (!fileData) {
      throw new Error('Failed to read file data');
    }

    const acceptValue = options?.format === 'html' ? 'text/html' : 'text/plain';

    try {
      const fetchOptions: RequestInit = {
        body: fileData as any,
        headers: { Accept: acceptValue },
        method: 'PUT',
      };

      // Add duplex option only in Node.js environments
      if (typeof window === 'undefined' && typeof process !== 'undefined') {
        (fetchOptions as any).duplex = 'half';
      }

      const res = await (this.fetch ?? fetch)(this.tikaUrl, fetchOptions);

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
    files: Readonly<string[] | Blob[]>,
    options?: Readonly<{ batchSize?: number; format?: 'html' | 'text' }>
  ): Promise<string[]> {
    const results: string[] = [];
    const bs = options?.batchSize ?? 10;

    for (let i = 0; i < files.length; i += bs) {
      const batch = files.slice(i, i + bs);
      const uploadPromises = batch.map((files) =>
        this._convert(files, { format: options?.format })
      );
      const batchResults = await Promise.all(uploadPromises);
      results.push(...batchResults);
    }

    return results;
  }
}
export default AxApacheTika;
