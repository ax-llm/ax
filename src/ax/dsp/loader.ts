import type { AxFieldValue } from './types.js'

export type AxDataRow = { row: Record<string, AxFieldValue> }

export class AxHFDataLoader {
  private rows: AxDataRow[] = []
  private baseUrl: string

  private dataset: string
  private split: string
  private config: string
  private options?: Readonly<{ offset?: number; length?: number }>

  constructor({
    dataset,
    split,
    config,
    options,
  }: Readonly<{
    dataset: string
    split: string
    config: string
    options?: Readonly<{ offset?: number; length?: number }>
  }>) {
    this.baseUrl = 'https://datasets-server.huggingface.co/rows'
    this.dataset = dataset
    this.split = split
    this.config = config
    this.options = options
  }

  private async fetchDataFromAPI(url: string): Promise<AxDataRow[]> {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Error fetching data: ${response.statusText}`)
      }
      const data = (await response.json()) as { rows: AxDataRow[] }
      if (!data?.rows) {
        throw new Error('Invalid data format')
      }
      return data.rows
    } catch (error) {
      console.error('Error fetching data from API:', error)
      throw error
    }
  }

  // https://datasets-server.huggingface.co/rows?dataset=hotpot_qa&config=distractor&split=train&offset=0&length=100

  public async loadData() {
    const offset = this.options?.offset ?? 0
    const length = this.options?.length ?? 100
    const ds = encodeURIComponent(this.dataset)

    const url = `${this.baseUrl}?dataset=${ds}&config=${this.config}&split=${this.split}&offset=${offset}&length=${length}`

    console.log('Downloading data from API.')
    this.rows = (await this.fetchDataFromAPI(url)) as AxDataRow[]
    return this.rows
  }

  public setData(rows: AxDataRow[]) {
    this.rows = rows
  }

  public getData() {
    return this.rows
  }

  public async getRows<T>({
    count,
    fields,
    renameMap,
  }: Readonly<{
    count: number
    fields: readonly string[]
    renameMap?: Record<string, string>
  }>): Promise<T[]> {
    if (this.rows.length === 0) {
      throw new Error('No data loaded, call loadData or setData first.')
    }
    const dataRows = this.rows.slice(0, count)

    return dataRows
      .map((item) => {
        const result: Record<string, AxFieldValue> = {}

        fields.forEach((field) => {
          const keys = field.split('.')
          // Initial value should match the type of the rows, and be indexable by string
          let value: AxFieldValue | unknown = item.row
          for (const key of keys) {
            // Use type assertion to tell TypeScript that value will always be an object that can be indexed with string keys
            if (
              Object.prototype.hasOwnProperty.call(
                value as Record<string, unknown>,
                key
              )
            ) {
              value = (value as Record<string, unknown>)[key]
            }
          }
          if (!value) {
            return
          }
          const resultFieldName =
            renameMap && field in renameMap ? renameMap[field] : field
          if (!resultFieldName) {
            throw new Error(`Invalid field name: ${field}`)
          }
          result[resultFieldName] = value as AxFieldValue
        })

        return result
      })
      .filter((v) => Object.keys(v).length !== 0) as T[]
  }
}
