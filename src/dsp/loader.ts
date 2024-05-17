import crypto from 'crypto'; // Import the crypto module to generate a hash
import fs from 'fs';
import path from 'path';

import type { Value } from './program.js';

type Row = { row: Record<string, Value> };

export class HFDataLoader {
  private baseUrl: string;
  private dataFolder: string;

  constructor() {
    this.baseUrl = 'https://datasets-server.huggingface.co/rows';
    this.dataFolder = path.join(process.cwd(), '.data');
    this.ensureDataFolderExists();
  }

  private ensureDataFolderExists(): void {
    if (!fs.existsSync(this.dataFolder)) {
      fs.mkdirSync(this.dataFolder, { recursive: true });
    }
  }

  private async fetchDataFromAPI(url: string): Promise<{ rows: Row[] }> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Error fetching data: ${response.statusText}`);
      }
      const data = (await response.json()) as { rows: Row[] };
      if (!data?.rows) {
        throw new Error('Invalid data format');
      }
      return data;
    } catch (error) {
      console.error('Error fetching data from API:', error);
      throw error;
    }
  }

  private getFilePath(url: string): string {
    // Generate a hash of the URL to use as a filename
    const hash = crypto.createHash('md5').update(url).digest('hex');
    return path.join(this.dataFolder, `${hash}.json`);
  }

  // https://datasets-server.huggingface.co/rows?dataset=hotpot_qa&config=distractor&split=train&offset=0&length=100

  public async loadData(
    dataset: string,
    split: 'train' | 'validation',
    options?: Readonly<{ offset?: number; length?: number }>
  ): Promise<{ rows: Row[] }> {
    const offset = options?.offset ?? 0;
    const length = options?.length ?? 100;

    const url = `${this.baseUrl}?dataset=${dataset}&config=distractor&split=${split}&offset=${offset}&length=${length}`;
    const filePath = this.getFilePath(url);

    if (fs.existsSync(filePath)) {
      console.log('Loading data from local file.');
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } else {
      console.log('Downloading data from API.');
      const data = (await this.fetchDataFromAPI(url)) as { rows: Row[] };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return data;
    }
  }

  public async getData<T>({
    dataset,
    split,
    count,
    fields,
    renameMap
  }: Readonly<{
    dataset: string;
    split: 'train' | 'validation';
    count: number;
    fields: readonly string[];
    renameMap?: Record<string, string>;
  }>): Promise<T[]> {
    const data = await this.loadData(dataset, split);
    const dataRows = data.rows.slice(0, count);

    return dataRows
      .map((item) => {
        const result: Record<string, Value> = {};

        fields.forEach((field) => {
          const keys = field.split('.');
          // Initial value should match the type of the rows, and be indexable by string
          let value: Value | unknown = item.row;
          for (const key of keys) {
            // Use type assertion to tell TypeScript that value will always be an object that can be indexed with string keys
            if (
              Object.prototype.hasOwnProperty.call(
                value as Record<string, unknown>,
                key
              )
            ) {
              value = (value as Record<string, unknown>)[key];
            }
          }
          if (!value) {
            return;
          }
          const resultFieldName =
            renameMap && field in renameMap ? renameMap[field] : field;
          if (!resultFieldName) {
            throw new Error(`Invalid field name: ${field}`);
          }
          result[resultFieldName] = value as Value;
        });

        return result;
      })
      .filter((v) => Object.keys(v).length !== 0) as T[];
  }
}
