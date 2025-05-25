import { createHash } from 'crypto'

import type { AxFunctionJSONSchema } from '../ai/types.js'

import {
  type InputParsedField,
  type OutputParsedField,
  type ParsedSignature,
  parseSignature,
} from './parser.js'

export interface AxField {
  name: string
  title?: string
  description?: string
  type?: {
    name:
      | 'string'
      | 'number'
      | 'boolean'
      | 'json'
      | 'image'
      | 'audio'
      | 'date'
      | 'datetime'
      | 'class'
      | 'code'
    isArray: boolean
    classes?: string[]
  }
  isOptional?: boolean
  isInternal?: boolean
}

export type AxIField = Omit<AxField, 'title'> & { title: string }

export class AxSignature {
  private description?: string
  private inputFields: AxIField[]
  private outputFields: AxIField[]

  private sigHash: string
  private sigString: string

  constructor(signature?: Readonly<AxSignature | string>) {
    if (!signature) {
      this.inputFields = []
      this.outputFields = []
      this.sigHash = ''
      this.sigString = ''
      return
    }

    if (typeof signature === 'string') {
      let sig: ParsedSignature
      try {
        sig = parseSignature(signature)
      } catch (e) {
        throw new Error(
          `Invalid Signature: ${(e as Error).message} (${signature})`
        )
      }
      this.description = sig.desc
      this.inputFields = sig.inputs.map((v) => this.parseParsedField(v))
      this.outputFields = sig.outputs.map((v) => this.parseParsedField(v))
      ;[this.sigHash, this.sigString] = this.updateHash()
    } else if (signature instanceof AxSignature) {
      this.description = signature.getDescription()
      this.inputFields = structuredClone(
        signature.getInputFields()
      ) as AxIField[]
      this.outputFields = structuredClone(
        signature.getOutputFields()
      ) as AxIField[]
      this.sigHash = signature.hash()
      this.sigString = signature.toString()
    } else {
      throw new Error('invalid signature argument: ' + signature)
    }
  }

  private parseParsedField = (
    field: Readonly<InputParsedField | OutputParsedField>
  ): AxIField => {
    if (!field.name || field.name.length === 0) {
      throw new Error('Field name is required.')
    }

    const title = this.toTitle(field.name)
    return {
      name: field.name,
      title,
      description: 'desc' in field ? field.desc : undefined,
      type: field.type ?? { name: 'string', isArray: false },
      ...('isInternal' in field ? { isInternal: field.isInternal } : {}),
      ...('isOptional' in field ? { isOptional: field.isOptional } : {}),
    }
  }

  private parseField = (field: Readonly<AxField>): AxIField => {
    const title =
      !field.title || field.title.length === 0
        ? this.toTitle(field.name)
        : field.title

    if (field.type && (!field.type.name || field.type.name.length === 0)) {
      throw new Error('Field type name is required: ' + field.name)
    }

    return { ...field, title }
  }

  public setDescription = (desc: string) => {
    this.description = desc
    this.updateHash()
  }

  public addInputField = (field: Readonly<AxField>) => {
    this.inputFields.push(this.parseField(field))
    this.updateHash()
  }

  public addOutputField = (field: Readonly<AxField>) => {
    this.outputFields.push(this.parseField(field))
    this.updateHash()
  }

  public setInputFields = (fields: readonly AxField[]) => {
    this.inputFields = fields.map((v) => this.parseField(v))
    this.updateHash()
  }

  public setOutputFields = (fields: readonly AxField[]) => {
    this.outputFields = fields.map((v) => this.parseField(v))
    this.updateHash()
  }

  public getInputFields = (): Readonly<AxIField[]> => this.inputFields
  public getOutputFields = (): Readonly<AxIField[]> => this.outputFields
  public getDescription = () => this.description

  private toTitle = (name: string) => {
    let result = name.replace(/_/g, ' ')
    result = result.replace(/([A-Z]|[0-9]+)/g, ' $1').trim()
    return result.charAt(0).toUpperCase() + result.slice(1)
  }

  public toJSONSchema = (): AxFunctionJSONSchema => {
    const properties: Record<string, unknown> = {}
    const required: Array<string> = []

    for (const f of this.inputFields) {
      const type = f.type ? f.type.name : 'string'
      if (f.type?.isArray) {
        properties[f.name] = {
          description: f.description,
          type: 'array' as const,
          items: {
            type: type,
            description: f.description,
          },
        }
      } else {
        properties[f.name] = {
          description: f.description,
          type: type,
        }
      }

      if (!f.isOptional) {
        required.push(f.name)
      }
    }

    const schema = {
      type: 'object',
      properties: properties,
      required: required,
    }

    return schema as AxFunctionJSONSchema
  }

  private updateHash = (): [string, string] => {
    this.getInputFields().forEach((field) => {
      validateField(field)
    })
    this.getOutputFields().forEach((field) => {
      validateField(field)
      if (field.type?.name === 'image') {
        throw new Error('Image type is not supported in output fields.')
      }
    })

    this.sigHash = createHash('sha256')
      .update(this.description ?? '')
      .update(JSON.stringify(this.inputFields))
      .update(JSON.stringify(this.outputFields))
      .digest('hex')

    this.sigString = renderSignature(
      this.description,
      this.inputFields,
      this.outputFields
    )

    return [this.sigHash, this.sigString]
  }

  public hash = () => this.sigHash

  public toString = () => this.sigString

  public toJSON = () => {
    return {
      id: this.hash(),
      description: this.description,
      inputFields: this.inputFields,
      outputFields: this.outputFields,
    }
  }
}

function renderField(field: Readonly<AxField>): string {
  let result = field.name
  if (field.isOptional) {
    result += '?'
  }
  if (field.type) {
    result += ':' + field.type.name
    if (field.type.isArray) {
      result += '[]'
    }
  }
  // Check if description exists and append it.
  if (field.description) {
    result += ` "${field.description}"`
  }
  return result
}

function renderSignature(
  description: string | undefined,
  inputFields: readonly AxField[],
  outputFields: readonly AxField[]
): string {
  // Prepare the description part of the signature.
  const descriptionPart = description ? `"${description}"` : ''

  // Render each input field into a comma-separated list.
  const inputFieldsRendered = inputFields.map(renderField).join(', ')

  // Render each output field into a comma-separated list.
  const outputFieldsRendered = outputFields.map(renderField).join(', ')

  // Combine all parts into the final signature.
  return `${descriptionPart} ${inputFieldsRendered} -> ${outputFieldsRendered}`
}

function isValidCase(inputString: string): boolean {
  const camelCaseRegex = /^[a-z][a-zA-Z0-9]*$/
  const snakeCaseRegex = /^[a-z]+(_[a-z0-9]+)*$/

  return camelCaseRegex.test(inputString) || snakeCaseRegex.test(inputString)
}

function validateField(field: Readonly<AxField>): void {
  if (!field.name || field.name.length === 0) {
    throw new Error('Field name cannot be blank')
  }

  if (!isValidCase(field.name)) {
    throw new Error(
      `Invalid field name '${field.name}', it must be camel case or snake case: `
    )
  }

  if (
    [
      'text',
      'object',
      'image',
      'string',
      'number',
      'boolean',
      'json',
      'array',
      'datetime',
      'date',
      'time',
      'type',
      'class',
    ].includes(field.name)
  ) {
    throw new Error(
      `Invalid field name '${field.name}', please make it more descriptive (eg. companyDescription)`
    )
  }
}
