export type AxFieldValue =
  | string
  | string[]
  | number
  | boolean
  | object
  | null
  | undefined
  | { mimeType: string; data: string }
  | { mimeType: string; data: string }[]
  | { format?: 'wav'; data: string }
  | { format?: 'wav'; data: string }[]

export type AxGenIn = { [key: string]: AxFieldValue }

export type AxGenOut = Record<string, AxFieldValue>

export type AxMessage =
  | { role: 'user'; values: AxGenIn }
  | { role: 'assistant'; values: AxGenOut };
