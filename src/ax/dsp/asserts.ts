import type { extractionState } from './extract.js'

export interface AxAssertion {
  fn(
    values: Record<string, unknown>
  ): Promise<boolean | undefined> | boolean | undefined
  message?: string
}

export interface AxStreamingAssertion {
  fieldName: string
  fn(content: string, done?: boolean): boolean | undefined
  message?: string
}

export class AxAssertionError extends Error {
  constructor({
    message,
  }: Readonly<{
    message: string
  }>) {
    super(message)
    this.name = this.constructor.name
  }

  public getFixingInstructions = () => {
    const extraFields = []
    const message = this.message.trim()

    extraFields.push({
      name: 'error',
      title: 'Follow these instructions',
      description: message + (message.endsWith('.') ? '' : '.'),
    })

    return extraFields
  }

  override toString(): string {
    return `${this.name}: ${this.message}`
  }

  [Symbol.for('nodejs.util.inspect.custom')](
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _depth: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: Record<string, unknown>
  ) {
    return this.toString()
  }
}

export const assertAssertions = async (
  asserts: readonly AxAssertion[],
  values: Record<string, unknown>
) => {
  for (const assert of asserts) {
    const { fn, message } = assert

    const res = await fn(values)
    if (res === undefined) {
      continue
    }

    if (!res) {
      if (!message) {
        throw new Error(`Assertion Failed: No message provided for assertion`)
      }
      throw new AxAssertionError({ message })
    }
  }
}

export const assertStreamingAssertions = async (
  asserts: readonly AxStreamingAssertion[],
  xstate: Readonly<extractionState>,
  content: string,
  final: boolean = false
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
    const { message, fn } = assert

    const res = await fn(currValue, final)
    if (res === undefined) {
      continue
    }

    if (!res && message) {
      throw new AxAssertionError({ message })
    }
  }
}
