import type { AxChatRequest } from '../ai/types.js'

import { formatDateWithTimezone } from './datetime.js'
import type { AxInputFunctionType } from './functions.js'
import type { AxField, AxIField, AxSignature } from './sig.js'
import type { AxFieldValue, AxGenIn, AxGenOut, AxMessage } from './types.js'
import { validateValue } from './util.js'

type Writeable<T> = { -readonly [P in keyof T]: T[P] }

// Define options type for AxPromptTemplate constructor
export interface AxPromptTemplateOptions {
  functions?: Readonly<AxInputFunctionType>
  thoughtFieldName?: string
}
type AxChatRequestChatPrompt = Writeable<AxChatRequest['chatPrompt'][0]>

type ChatRequestUserMessage = Exclude<
  Extract<AxChatRequestChatPrompt, { role: 'user' }>['content'],
  string
>

const functionCallInstructions = `
## Function Call Instructions
- Complete the task, using the functions defined earlier in this prompt. 
- Call functions step-by-step, using the output of one function as input to the next.
- Use the function results to generate the output fields.`

const formattingRules = `
## Strict Output Formatting Rules
- Output must strictly follow the defined plain-text \`field name: value\` field format.
- Output field, values must strictly adhere to the specified output field formatting rules.
- Do not add any text before or after the output fields, just the field name and value.
- Do not use code blocks.`

export type AxFieldTemplateFn = (
  field: Readonly<AxField>,
  value: Readonly<AxFieldValue>
) => ChatRequestUserMessage

export class AxPromptTemplate {
  private sig: Readonly<AxSignature>
  private fieldTemplates?: Record<string, AxFieldTemplateFn>
  private task: { type: 'text'; text: string }
  private readonly thoughtFieldName: string
  private readonly functions?: Readonly<AxInputFunctionType>

  constructor(
    sig: Readonly<AxSignature>,
    options?: Readonly<AxPromptTemplateOptions>,
    fieldTemplates?: Record<string, AxFieldTemplateFn>
  ) {
    this.sig = sig
    this.fieldTemplates = fieldTemplates
    this.thoughtFieldName = options?.thoughtFieldName ?? 'thought'
    this.functions = options?.functions

    const task = []

    const inArgs = renderDescFields(this.sig.getInputFields())
    const outArgs = renderDescFields(this.sig.getOutputFields())
    task.push(
      `You will be provided with the following fields: ${inArgs}. Your task is to generate new fields: ${outArgs}.`
    )

    // biome-ignore lint/complexity/useFlatMap: you cannot use flatMap here
    const funcs = this.functions
      ?.map((f) => ('toFunction' in f ? f.toFunction() : f))
      ?.flat()

    const funcList = funcs
      ?.map((fn) => `- \`${fn.name}\`: ${formatDescription(fn.description)}`)
      .join('\n')

    if (funcList && funcList.length > 0) {
      task.push(`## Available Functions\n${funcList}`)
    }

    const inputFields = renderInputFields(this.sig.getInputFields())
    task.push(`## Input Fields\n${inputFields}`)

    const outputFields = renderOutputFields(this.sig.getOutputFields())
    task.push(`## Output Fields\n${outputFields}`)

    if (funcList && funcList.length > 0) {
      task.push(functionCallInstructions.trim())
    }

    task.push(formattingRules.trim())

    const desc = this.sig.getDescription()
    if (desc) {
      const text = formatDescription(desc)
      task.push(text)
    }

    this.task = {
      type: 'text' as const,
      text: task.join('\n\n'),
    }
  }

  public render = <T extends AxGenIn>(
    values: T | ReadonlyArray<AxMessage>, // Allow T (AxGenIn) or array of AxMessages
    {
      examples,
      demos,
    }: Readonly<{
      skipSystemPrompt?: boolean
      examples?: Record<string, AxFieldValue>[] // Keep as is, examples are specific structures
      demos?: Record<string, AxFieldValue>[] // Keep as is
    }>
  ): AxChatRequest['chatPrompt'] => {
    const renderedExamples = examples
      ? [
          { type: 'text' as const, text: '\n\n## Examples\n' },
          ...this.renderExamples(examples),
        ]
      : []

    const renderedDemos = demos ? this.renderDemos(demos) : []

    // Check if demos and examples are all text type
    const allTextExamples = renderedExamples.every((v) => v.type === 'text')
    const allTextDemos = renderedDemos.every((v) => v.type === 'text')
    const examplesInSystemPrompt = allTextExamples && allTextDemos

    let systemContent = this.task.text

    if (examplesInSystemPrompt) {
      const combinedItems = [
        { type: 'text' as const, text: systemContent },
        ...renderedExamples,
        ...renderedDemos,
      ]
      combinedItems.reduce(combineConsecutiveStrings(''), [])

      if (combinedItems && combinedItems[0]) {
        systemContent = combinedItems[0].text
      }
    }

    const systemPrompt = {
      role: 'system' as const,
      content: systemContent,
    }

    // Define a more specific type for messages we construct for the chat history part
    type HistoryChatMessage =
      | { role: 'user'; content: string }
      | { role: 'assistant'; content: string }

    let userMessages: HistoryChatMessage[] = []

    if (Array.isArray(values)) {
      // values is ReadonlyArray<AxMessage>
      const history = values as ReadonlyArray<AxMessage> // Type assertion
      let lastRole: 'user' | 'assistant' | undefined = undefined

      for (const message of history) {
        let messageContent = ''
        if (message.role === 'user') {
          // For user messages, render their 'values' (which is AxGenIn)
          // renderInputFields expects the actual values object.
          const userMsgParts = this.renderInputFields(
            message.values as unknown as T // Cast message.values (AxGenIn) to T (which extends AxGenIn)
          )
          messageContent = userMsgParts
            .map((part) => (part.type === 'text' ? part.text : '')) // Simplify: combine text parts
            .join('') // Join without adding extra newlines
            .trim() // Trim trailing newline from the last part
        } else if (message.role === 'assistant') {
          // For assistant messages, format their 'values' (AxGenOut)
          const assistantValues = message.values as AxGenOut
          let assistantContentParts: string[] = []
          const outputFields = this.sig.getOutputFields()

          for (const field of outputFields) {
            const value = assistantValues[field.name]

            if (
              value !== undefined &&
              value !== null &&
              (typeof value === 'string' ? value !== '' : true)
            ) {
              const renderedValue = processValue(field, value)
              assistantContentParts.push(`${field.name}: ${renderedValue}`) // Use field.name instead of field.title
            } else {
              // Field is missing or effectively empty
              const isThoughtField = field.name === this.thoughtFieldName
              if (!field.isOptional && !field.isInternal && !isThoughtField) {
                throw new Error(
                  `Value for output field '${field.name}' ('${field.title}') is required in assistant message history but was not found or was empty.`
                )
              }
              // If optional, internal, or thought, it's okay for it to be missing/empty. Skip.
            }
          }
          messageContent = assistantContentParts.join('\n')
        }

        if (messageContent) {
          if (lastRole === message.role && userMessages.length > 0) {
            // Combine with previous message of the same role
            const lastMessage = userMessages[userMessages.length - 1]
            if (lastMessage) {
              lastMessage.content += '\n' + messageContent
            }
          } else {
            if (message.role === 'user') {
              userMessages.push({ role: 'user', content: messageContent })
            } else if (message.role === 'assistant') {
              userMessages.push({ role: 'assistant', content: messageContent })
            }
          }
          lastRole = message.role
        }
      }
    } else {
      // values is T (AxGenIn) - existing logic path
      const currentValues: T = values as T
      const completion = this.renderInputFields(currentValues)
      const promptList: ChatRequestUserMessage = examplesInSystemPrompt
        ? completion
        : [...renderedExamples, ...renderedDemos, ...completion]

      const promptFilter = promptList.filter((v) => v !== undefined)

      let userContent: string
      if (promptFilter.every((v) => v.type === 'text')) {
        userContent = promptFilter
          .map((v) => (v as { type: 'text'; text: string }).text)
          .join('\n')
      } else {
        userContent = promptFilter
          .map((part) => {
            if (part.type === 'text') return part.text
            if (part.type === 'image') return '[IMAGE]'
            if (part.type === 'audio') return '[AUDIO]'
            return ''
          })
          .join('\n')
          .trim()
      }
      userMessages.push({ role: 'user' as const, content: userContent })
    }

    return [systemPrompt, ...userMessages]
  }

  public renderExtraFields = (extraFields: readonly AxIField[]) => {
    const prompt: ChatRequestUserMessage = []

    if (!extraFields || extraFields.length === 0) {
      return prompt
    }

    const groupedFields = extraFields.reduce(
      (acc, field) => {
        const title = field.title
        if (!acc[title]) {
          acc[title] = []
        }
        acc[title].push(field)
        return acc
      },
      {} as Record<string, AxIField[]>
    )

    const formattedGroupedFields = Object.entries(groupedFields)
      .map(([title, fields]) => {
        if (fields.length === 1) {
          const field = fields[0]!
          return {
            title,
            name: field.name,
            description: field.description,
          }
        } else if (fields.length > 1) {
          const valuesList = fields
            .map((field) => `- ${field.description}`)
            .join('\n')
          return {
            title,
            name: fields[0]!.name,
            description: valuesList,
          }
        }
      })
      .filter(Boolean) as AxIField[]

    formattedGroupedFields.forEach((field) => {
      const fn = this.fieldTemplates?.[field.name] ?? this.defaultRenderInField
      prompt.push(...fn(field, field.description))
    })

    return prompt
  }

  private renderExamples = (data: Readonly<Record<string, AxFieldValue>[]>) => {
    const list: ChatRequestUserMessage = []

    for (const [index, item] of data.entries()) {
      const renderedInputItem = this.sig
        .getInputFields()
        .map((field) => this.renderInField(field, item)) // Corrected: 2 args
        .filter((v) => v !== undefined)
        .flat()

      const renderedOutputItem = this.sig
        .getOutputFields()
        .map((field) => this.renderInField(field, item)) // Corrected: 2 args
        .filter((v) => v !== undefined)
        .flat()

      if (renderedOutputItem.length === 0) {
        throw new Error(
          `Output fields are required in examples: index: ${index}, data: ${JSON.stringify(item)}`
        )
      }

      const renderedItem = [...renderedInputItem, ...renderedOutputItem]

      if (
        index > 0 &&
        renderedItem.length > 0 &&
        renderedItem[0]?.type === 'text'
      ) {
        list.push({ type: 'text' as const, text: '---\n\n' })
      }

      renderedItem.forEach((v) => {
        if ('text' in v) {
          v.text = v.text + '\n'
        }
        if ('image' in v) {
          v.image = v.image
        }
        list.push(v)
      })
    }

    return list
  }

  private renderDemos = (data: Readonly<Record<string, AxFieldValue>[]>) => {
    const list: ChatRequestUserMessage = []

    const fields = [...this.sig.getInputFields(), ...this.sig.getOutputFields()]

    for (const item of data) {
      const renderedItem = fields
        .map((field) => this.renderInField(field, item)) // Corrected: 2 args
        .filter((v) => v !== undefined)
        .flat()

      renderedItem.slice(0, -1).forEach((v) => {
        if ('text' in v) {
          v.text = v.text + '\n'
        }
        if ('image' in v) {
          v.image = v.image
        }
        list.push(v)
      })
    }

    return list
  }

  private renderInputFields = <T extends AxGenIn>(values: T) => {
    const renderedItems = this.sig
      .getInputFields()
      .map((field) => this.renderInField(field, values))
      .filter((v) => v !== undefined)
      .flat()

    renderedItems
      .filter((v) => v.type === 'text')
      .forEach((v) => {
        v.text = v.text + '\n'
      })

    return renderedItems
  }

  private renderInField = (
    field: Readonly<AxField>,
    values: Readonly<Record<string, AxFieldValue>>
  ) => {
    const value = values[field.name]

    if (isEmptyValue(field, value)) {
      return
    }

    if (field.type) {
      validateValue(field, value!)
    }

    const processedValue = processValue(field, value!)

    const textFieldFn: AxFieldTemplateFn =
      this.fieldTemplates?.[field.name] ?? this.defaultRenderInField

    return textFieldFn(field, processedValue)
  }

  private defaultRenderInField = (
    field: Readonly<AxField>,
    value: Readonly<AxFieldValue>
  ): ChatRequestUserMessage => {
    if (field.type?.name === 'image') {
      const validateImage = (
        value: Readonly<AxFieldValue>
      ): { mimeType: string; data: string } => {
        if (!value) {
          throw new Error('Image field value is required.')
        }

        if (typeof value !== 'object') {
          throw new Error('Image field value must be an object.')
        }
        if (!('mimeType' in value)) {
          throw new Error('Image field must have mimeType')
        }
        if (!('data' in value)) {
          throw new Error('Image field must have data')
        }
        return value as { mimeType: string; data: string }
      }

      let result: ChatRequestUserMessage = [
        { type: 'text', text: `${field.title}: ` as string },
      ]

      if (field.type.isArray) {
        if (!Array.isArray(value)) {
          throw new Error('Image field value must be an array.')
        }
        result = result.concat(
          (value as unknown[]).map((v) => {
            // Cast to unknown[] before map
            const validated = validateImage(v as AxFieldValue)
            return {
              type: 'image',
              mimeType: validated.mimeType,
              image: validated.data,
            }
          })
        )
      } else {
        const validated = validateImage(value)
        result.push({
          type: 'image',
          mimeType: validated.mimeType,
          image: validated.data,
        })
      }
      return result
    }

    if (field.type?.name === 'audio') {
      const validateAudio = (
        value: Readonly<AxFieldValue>
      ): { format?: 'wav'; data: string } => {
        if (!value) {
          throw new Error('Audio field value is required.')
        }

        if (typeof value !== 'object') {
          throw new Error('Audio field value must be an object.')
        }
        if (!('data' in value)) {
          throw new Error('Audio field must have data')
        }
        return value as { format?: 'wav'; data: string }
      }

      let result: ChatRequestUserMessage = [
        { type: 'text', text: `${field.title}: ` as string },
      ]

      if (field.type.isArray) {
        if (!Array.isArray(value)) {
          throw new Error('Audio field value must be an array.')
        }
        result = result.concat(
          (value as unknown[]).map((v) => {
            // Cast to unknown[] before map
            const validated = validateAudio(v as AxFieldValue)
            return {
              type: 'audio',
              format: validated.format ?? 'wav',
              data: validated.data,
            }
          })
        )
      } else {
        const validated = validateAudio(value)
        result.push({
          type: 'audio',
          format: validated.format ?? 'wav',
          data: validated.data,
        })
      }
      return result
    }

    const text = [field.title, ': ']

    if (Array.isArray(value)) {
      text.push('\n')
      text.push(value.map((v) => `- ${v}`).join('\n'))
    } else {
      text.push(value as string)
    }
    return [{ type: 'text', text: text.join('') }]
  }
}

const renderDescFields = (list: readonly AxField[]) =>
  list.map((v) => `\`${v.title}\``).join(', ')

const renderInputFields = (fields: readonly AxField[]) => {
  const rows = fields.map((field) => {
    const name = field.title
    const type = field.type?.name ? toFieldType(field.type) : 'string'

    const requiredMsg = field.isOptional
      ? `This optional ${type} field may be omitted`
      : `A ${type} field`

    const description = field.description
      ? ` ${formatDescription(field.description)}`
      : ''

    return `${name}: (${requiredMsg})${description}`.trim()
  })

  return rows.join('\n')
}

const renderOutputFields = (fields: readonly AxField[]) => {
  const rows = fields.map((field) => {
    const name = field.title
    const type = field.type?.name ? toFieldType(field.type) : 'string'

    const requiredMsg = field.isOptional
      ? `Only include this ${type} field if its value is available`
      : `This ${type} field must be included`

    const description = field.description
      ? ` ${formatDescription(field.description)}`
      : ''

    return `${name}: (${requiredMsg})${description}`.trim()
  })

  return rows.join('\n')
}

const processValue = (
  field: Readonly<AxField>,
  value: Readonly<AxFieldValue>
): AxFieldValue => {
  if (field.type?.name === 'date' && value instanceof Date) {
    const v = value.toISOString()
    return v.slice(0, v.indexOf('T'))
  }
  if (field.type?.name === 'datetime' && value instanceof Date) {
    return formatDateWithTimezone(value)
  }
  if (field.type?.name === 'image' && typeof value === 'object') {
    return value
  }
  if (field.type?.name === 'audio' && typeof value === 'object') {
    return value
  }
  if (typeof value === 'string') {
    return value
  }
  return JSON.stringify(value, null, 2)
}

export const toFieldType = (type: Readonly<AxField['type']>) => {
  const baseType = (() => {
    switch (type?.name) {
      case 'string':
        return 'string'
      case 'number':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'date':
        return 'date ("YYYY-MM-DD" format)'
      case 'datetime':
        return 'date time ("YYYY-MM-DD HH:mm Timezone" format)'
      case 'json':
        return 'JSON object'
      case 'class':
        return `classification class (allowed classes: ${type.classes?.join(', ')})`
      case 'code':
        return 'code'
      default:
        return 'string'
    }
  })()

  return type?.isArray ? `json array of ${baseType} items` : baseType
}

function combineConsecutiveStrings(separator: string) {
  return (acc: ChatRequestUserMessage, current: ChatRequestUserMessage[0]) => {
    if (current.type === 'text') {
      const previous = acc.length > 0 ? acc[acc.length - 1] : null
      if (previous && previous.type === 'text') {
        previous.text += separator + current.text
      } else {
        acc.push(current)
      }
    } else {
      acc.push(current)
    }
    return acc
  }
}

const isEmptyValue = (
  field: Readonly<AxField>,
  value?: Readonly<AxFieldValue>
) => {
  if (typeof value === 'boolean') {
    return false
  }

  if (
    !value ||
    ((Array.isArray(value) || typeof value === 'string') && value.length === 0)
  ) {
    if (field.isOptional || field.isInternal) {
      return true
    }
    throw new Error(`Value for input field '${field.name}' is required.`)
  }
  return false
}

function formatDescription(str: string) {
  const value = str.trim()
  return value.length > 0
    ? `${value.charAt(0).toUpperCase()}${value.slice(1)}${value.endsWith('.') ? '' : '.'}`
    : ''
}
