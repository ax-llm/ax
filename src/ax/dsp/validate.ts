import { toFieldType } from './prompt.js'
import type { AxField } from './sig.js'

export class ValidationError extends Error {
  private field: AxField
  private value: string

  constructor({
    message,
    field,
    value,
  }: Readonly<{
    message: string
    field: AxField
    value: string
  }>) {
    super(message)
    this.field = field
    this.value = value
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }

  public getField = () => this.field
  public getValue = () => this.value

  public getFixingInstructions = () => {
    const f = this.field

    const extraFields = [
      {
        name: `outputError`,
        title: `Invalid Output Field`,
        description: `Invalid format for field \`${f.title}\` of type \`${toFieldType(f.type)}\`, format should match: \`${f.description}\``,
      },
    ]

    return extraFields
  }
}
