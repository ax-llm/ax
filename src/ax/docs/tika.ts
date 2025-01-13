import { createReadStream } from 'node:fs'

export interface AxApacheTikaArgs {
  url?: string | URL
  fetch?: typeof fetch
}

export interface AxApacheTikaConvertOptions {
  format?: 'text' | 'html'
}

export class AxApacheTika {
  private tikaUrl: URL
  private fetch?: typeof fetch

  constructor(args?: Readonly<AxApacheTikaArgs>) {
    const _args = args ?? { url: 'http://localhost:9998/' }
    this.tikaUrl = new URL('/tika', _args.url)
    this.fetch = _args.fetch
  }

  private async _convert(
    file: string | Blob,
    options?: Readonly<AxApacheTikaConvertOptions>
  ): Promise<string> {
    const fileData =
      typeof file === 'string' ? createReadStream(file) : file.stream()

    if (!fileData) {
      throw new Error('Failed to read file data')
    }

    const acceptValue = options?.format === 'html' ? 'text/html' : 'text/plain'

    try {
      const res = await (this.fetch ?? fetch)(this.tikaUrl, {
        body: fileData,
        headers: { Accept: acceptValue },
        duplex: 'half',
        method: 'PUT',
      })

      if (!res.ok) {
        throw new Error(`Failed to upload file: ${res.statusText}`)
      }

      const text = await res.text()
      return text
    } catch (error) {
      throw new Error(`Error converting file: ${error}`)
    }
  }

  public async convert(
    files: Readonly<string[] | Blob[]>,
    options?: Readonly<{ batchSize?: number; format?: 'html' | 'text' }>
  ): Promise<string[]> {
    const results: string[] = []
    const bs = options?.batchSize ?? 10

    for (let i = 0; i < files.length; i += bs) {
      const batch = files.slice(i, i + bs)
      const uploadPromises = batch.map((files) =>
        this._convert(files, { format: options?.format })
      )
      const batchResults = await Promise.all(uploadPromises)
      results.push(...batchResults)
    }

    return results
  }
}
export default AxApacheTika
