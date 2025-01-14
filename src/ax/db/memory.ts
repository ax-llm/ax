import { AxDBBase, type AxDBBaseArgs, type AxDBBaseOpOptions } from './base.js'
import type {
  AxDBQueryRequest,
  AxDBQueryResponse,
  AxDBUpsertRequest,
  AxDBUpsertResponse,
} from './types.js'

export type AxDBMemoryOpOptions = AxDBBaseOpOptions

export interface AxDBMemoryArgs extends AxDBBaseArgs {
  name: 'memory'
}

export type AxDBState = Record<string, Record<string, AxDBUpsertRequest>>

/**
 * MemoryDB: DB Service
 */
export class AxDBMemory extends AxDBBase {
  private state: AxDBState

  constructor({ tracer }: Readonly<Omit<AxDBMemoryArgs, 'name'>> = {}) {
    super({ name: 'Memory', tracer })
    this.state = {}
  }

  override _upsert = async (
    req: Readonly<AxDBUpsertRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _update?: boolean,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AxDBMemoryOpOptions>
  ): Promise<AxDBUpsertResponse> => {
    if (!this.state[req.table]) {
      this.state[req.table] = {
        [req.id]: req,
      }
    } else {
      const obj = this.state[req.table]
      if (!obj) {
        throw new Error('Table not found: ' + req.table)
      }
      obj[req.id] = req
    }

    return { ids: [req.id] }
  }

  override _batchUpsert = async (
    batchReq: Readonly<AxDBUpsertRequest[]>,
    update?: boolean,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AxDBMemoryOpOptions>
  ): Promise<AxDBUpsertResponse> => {
    const ids: string[] = []
    for (const req of batchReq) {
      const res = await this.upsert(req, update)
      ids.push(...res.ids)
    }

    return { ids }
  }

  override _query = async (
    req: Readonly<AxDBQueryRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AxDBMemoryOpOptions>
  ): Promise<AxDBQueryResponse> => {
    const table = this.state[req.table]
    if (!table) {
      return { matches: [] }
    }

    const matches: AxDBQueryResponse['matches'] = []

    Object.entries(table).forEach(([id, data]) => {
      if (req.values && data.values) {
        const score = distance(req.values, data.values)
        matches.push({ id: id, score: score, metadata: data.metadata })
      }
    })

    matches.sort((a, b) => a.score - b.score)
    if (req.limit) {
      matches.length = req.limit
    }

    return { matches }
  }

  public getDB = () => {
    return structuredClone(this.state)
  }

  public setDB = (state: AxDBState) => {
    this.state = structuredClone(state)
  }

  public clearDB = () => {
    this.state = {}
  }
}

const distance = (a: readonly number[], b: readonly number[]): number => {
  if (a.length !== b.length) {
    throw new Error('Vectors must be of the same length.')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0
  let zeroVectorA = true
  let zeroVectorB = true

  const vectorA = new Float64Array(a)
  const vectorB = new Float64Array(b)

  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i]! * vectorB[i]!
    normA += vectorA[i]! * vectorA[i]!
    normB += vectorB[i]! * vectorB[i]!
    if (vectorA[i] !== 0) zeroVectorA = false
    if (vectorB[i] !== 0) zeroVectorB = false
  }

  if (zeroVectorA || zeroVectorB) {
    return 1 // Return maximum distance if one vector is zero
  }

  const sqrtNormA = Math.sqrt(normA)
  const sqrtNormB = Math.sqrt(normB)
  const similarity = dotProduct / (sqrtNormA * sqrtNormB)
  return 1 - similarity // Returning distance as 1 - cosine similarity.
}
