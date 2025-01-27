import type { AxAIService } from '../ai/types.js'
import type { AxAIMemory } from '../mem/types.js'
import { ColorLog } from '../util/log.js'

import { AxPromptTemplate, toFieldType } from './prompt.js'
import type { AxField, AxIField } from './sig.js'

const colorLog = new ColorLog()

export class ValidationError extends Error {
  private fields: AxField[]

  constructor({
    message,
    fields,
  }: Readonly<{
    message: string
    fields: AxField[]
    value?: string
  }>) {
    super(message)
    this.fields = fields
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }

  public getFields = () => this.fields

  public getFixingInstructions = () => {
    return this.fields.map((field) => ({
      name: 'outputError',
      title: 'Error In Output',
      description: `Please fix and return the field \`${field.title}\` of type \`${toFieldType(field.type)}\`, ${this.message}.`,
    }))
  }
}

export function handleValidationError(
  mem: AxAIMemory,
  errorFields: AxIField[],
  ai: Readonly<AxAIService>,
  promptTemplate: Readonly<AxPromptTemplate>,
  sessionId?: string
) {
  mem.add(
    {
      role: 'user' as const,
      content: promptTemplate.renderExtraFields(errorFields),
    },
    sessionId
  )
  mem.addTag('error')

  if (ai.getOptions().debug) {
    process.stdout.write(
      colorLog.red(
        `\nError Correction:\n${JSON.stringify(errorFields, null, 2)}\n`
      )
    )
  }
}
