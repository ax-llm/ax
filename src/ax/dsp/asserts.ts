import type { extractionState } from './extract.js'
import type { AxSignature } from './sig.js'

export interface AxAssertion {
  fn(values: Record<string, unknown>): boolean | undefined
  message?: string
  optional?: boolean
}

export interface AxStreamingAssertion {
  fieldName: string
  fn(content: string, done?: boolean): boolean | undefined
  message?: string
  optional?: boolean
}

export class AxAssertionError extends Error {
  private values: Record<string, unknown>
  private optional?: boolean

  constructor({
    message,
    values,
    optional,
  }: Readonly<{
    message: string
    values: Record<string, unknown>
    optional?: boolean
  }>) {
    super(message)
    this.values = values
    this.optional = optional
    this.name = this.constructor.name
    this.stack = new Error().stack
  }
  public getValue = () => this.values
  public getOptional = () => this.optional

  public getFixingInstructions = () => {
    const extraFields = []

    extraFields.push({
      name: 'error',
      title: 'Error In Output',
      description: `You must follow the following instructions, "${this.message}".`,
    })

    return extraFields
  }
}

export const assertAssertions = (
  asserts: readonly AxAssertion[],
  values: Record<string, unknown>
) => {
  for (const assert of asserts) {
    const { fn, message, optional } = assert

    const res = fn(values)
    if (res === undefined) {
      continue
    }

    if (!res && message) {
      throw new AxAssertionError({ message, values, optional })
    }
  }
}

export const assertStreamingAssertions = (
  asserts: readonly AxStreamingAssertion[],
  values: Record<string, unknown>,
  xstate: Readonly<extractionState>,
  content: string,
  final: boolean
) => {
  if (
    !xstate.currField ||
    xstate.s === -1 ||
    !asserts ||
    asserts.length === 0
  ) {
    return
  }

  const fieldAsserts = asserts.filter(
    (a) => a.fieldName === xstate.currField?.name
  )

  if (fieldAsserts.length === 0) {
    return
  }

  const currValue = content.substring(xstate.s)

  for (const assert of fieldAsserts) {
    const { message, optional, fn } = assert

    const res = fn(currValue, final)
    if (res === undefined) {
      continue
    }

    if (!res && message) {
      throw new AxAssertionError({ message, values, optional })
    }
  }
}

export const assertRequiredFields = (
  sig: Readonly<AxSignature>,
  values: Record<string, unknown>
) => {
  const fields = sig.getOutputFields()
  const missingFields = fields.filter(
    (f) => !f.isOptional && !(f.name in values)
  )
  if (missingFields.length > 0) {
    throw new AxAssertionError({
      message: `You must include the following fields in the output as instructed above: ${missingFields.map((f) => `\`${f.title}\``).join(', ')}`,
      values,
    })
  }
}
