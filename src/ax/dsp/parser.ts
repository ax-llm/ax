// Keeping the type definitions the same
export type TypeNotClass =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
  | 'image'
  | 'audio'
  | 'datetime'
  | 'date'
  | 'code'
export type Type = TypeNotClass | 'class'
export type ParsedIdentifier = string
export type ParsedString = string

export type ParsedSignature = {
  desc?: string
  inputs: InputParsedFieldList
  outputs: OutputParsedFieldList
}

export type InputParsedFieldList = InputParsedField[]
export type OutputParsedFieldList = OutputParsedField[]

export type ClassField = {
  name: ParsedIdentifier
  type: { name: 'class'; isArray: boolean; classes: string[] }
  isOptional: boolean
}

export type NonClassField = {
  name: ParsedIdentifier
  desc?: string
  type: NonNullable<{ name: TypeNotClass; isArray: boolean } | null> | undefined
  isOptional: boolean
}

export type InputParsedField = ClassField | NonClassField
export type OutputParsedField = ClassField | NonClassField

class SignatureParser {
  private input: string
  private position: number
  private currentFieldName: string | null = null

  constructor(input: string) {
    this.input = input
    this.position = 0
  }

  parse(): ParsedSignature {
    try {
      this.skipWhitespace()
      const optionalDesc = this.parseParsedString()
      this.skipWhitespace()
      const inputs = this.parseFieldList(this.parseField.bind(this), 'input')
      this.skipWhitespace()

      if (this.position >= this.input.length) {
        throw new Error(
          'Incomplete signature: Missing output section. Expected "->" followed by output fields'
        )
      }

      this.expect('->')
      this.skipWhitespace()

      if (this.position >= this.input.length) {
        throw new Error(
          'Incomplete signature: No output fields specified after "->"'
        )
      }

      const outputs = this.parseFieldList(this.parseField.bind(this), 'output')

      return {
        desc: optionalDesc?.trim(),
        inputs,
        outputs,
      }
    } catch (error) {
      // Add context about the position where the error occurred
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      const context = this.getErrorContext()
      throw new Error(`${errorMessage}\n${context}`)
    }
  }

  private getErrorContext(): string {
    const start = Math.max(0, this.position - 20)
    const end = Math.min(this.input.length, this.position + 20)
    const before = this.input.slice(start, this.position)
    const after = this.input.slice(this.position, end)
    const pointer = ' '.repeat(before.length) + '^'

    return `Near position ${this.position}:\n${before}${after}\n${pointer}`
  }

  private parseFieldList<T extends InputParsedField | OutputParsedField>(
    parseFieldFn: () => T,
    section: 'input' | 'output'
  ): T[] {
    const fields: T[] = []
    this.skipWhitespace()

    if (this.position >= this.input.length) {
      throw new Error(`Empty ${section} section: Expected at least one field`)
    }

    // Parse first field
    try {
      fields.push(parseFieldFn())
    } catch (error) {
      throw new Error(
        `Invalid first ${section} field: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }

    this.skipWhitespace()

    // Parse remaining fields
    while (this.position < this.input.length) {
      if (
        this.input[this.position] === '-' &&
        this.input[this.position + 1] === '>'
      ) {
        break
      }

      if (this.match(',')) {
        this.skipWhitespace()
        if (this.position >= this.input.length) {
          throw new Error(
            `Unexpected end of input after comma in ${section} section`
          )
        }
        try {
          fields.push(parseFieldFn())
        } catch (error) {
          throw new Error(
            `Invalid ${section} field after comma: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        }
        this.skipWhitespace()
      } else {
        break
      }
    }

    return fields
  }

  private parseField(): InputParsedField | OutputParsedField {
    this.skipWhitespace()
    const name = this.parseParsedIdentifier()
    this.currentFieldName = name

    const isOptional = this.match('?')
    let type:
      | { name: TypeNotClass; isArray: boolean }
      | { name: 'class'; isArray: boolean; classes: string[] }
      | undefined

    // Skip whitespace before the colon
    this.skipWhitespace()
    if (this.match(':')) {
      this.skipWhitespace()
      if (this.match('class')) {
        const isArray = this.match('[]')
        this.skipWhitespace()
        const desc = this.parseParsedString()
        if (!desc) {
          throw new Error(
            `Field "${name}": Expected class names in quotes after "class" type. Example: class "MyClass1, MyClass2"`
          )
        }
        const classes = desc
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)

        if (classes.length === 0) {
          throw new Error(
            `Field "${name}": Empty class list provided. At least one class name is required`
          )
        }

        type = { name: 'class' as const, isArray, classes }
      } else {
        try {
          const typeName = this.parseTypeNotClass()
          const isArray = this.match('[]')
          type = { name: typeName, isArray }
        } catch (error) {
          throw new Error(
            `Field "${name}": ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        }
      }
    }

    this.skipWhitespace()
    const desc = this.parseParsedString()

    if (type?.name === 'class') {
      return {
        name,
        desc: desc?.trim(),
        type,
        isOptional,
      }
    } else {
      return {
        name,
        desc: desc?.trim(),
        type,
        isOptional,
      }
    }
  }

  private parseTypeNotClass(): TypeNotClass {
    const types: TypeNotClass[] = [
      'string',
      'number',
      'boolean',
      'json',
      'image',
      'audio',
      'datetime',
      'date',
      'code',
    ]

    const foundType = types.find((type) => this.match(type))
    if (!foundType) {
      const currentWord =
        this.input.slice(this.position).match(/^\w+/)?.[0] || 'empty'
      throw new Error(
        `Invalid type "${currentWord}". Expected one of: ${types.join(', ')}`
      )
    }
    return foundType
  }

  private parseParsedIdentifier(): ParsedIdentifier {
    this.skipWhitespace()
    const match = /^[a-zA-Z_][a-zA-Z_0-9]*/.exec(
      this.input.slice(this.position)
    )
    if (match) {
      this.position += match[0].length
      return match[0]
    }

    // Get the invalid identifier attempt
    const invalidMatch = /^\S+/.exec(this.input.slice(this.position))
    const invalidId = invalidMatch ? invalidMatch[0] : 'empty'

    throw new Error(
      `Invalid identifier "${invalidId}". Identifiers must start with a letter or underscore and contain only letters, numbers, or underscores`
    )
  }

  private parseParsedString(): string | undefined {
    const quoteChars = ["'", '"']
    for (const quoteChar of quoteChars) {
      if (this.match(quoteChar)) {
        let content = ''
        let escaped = false
        let startPos = this.position

        while (this.position < this.input.length) {
          const char = this.input[this.position]
          this.position++
          if (escaped) {
            content += char
            escaped = false
          } else if (char === '\\') {
            escaped = true
          } else if (char === quoteChar) {
            return content
          } else {
            content += char
          }
        }

        // If we get here, the string was not terminated
        const partialString = this.input.slice(startPos, this.position)
        throw new Error(
          `Unterminated string starting at position ${startPos}: "${partialString}..."`
        )
      }
    }
    return undefined
  }

  private skipWhitespace() {
    const match = /^[\s\t\r\n]+/.exec(this.input.slice(this.position))
    if (match) {
      this.position += match[0].length
    }
  }

  private match(strOrRegex: string | RegExp): boolean {
    let match
    if (typeof strOrRegex === 'string') {
      if (this.input.startsWith(strOrRegex, this.position)) {
        this.position += strOrRegex.length
        return true
      }
    } else {
      match = strOrRegex.exec(this.input.slice(this.position))
      if (match) {
        this.position += match[0].length
        return true
      }
    }
    return false
  }

  private expect(str: string) {
    if (!this.match(str)) {
      const found = this.input.slice(this.position, this.position + 10)
      throw new Error(
        `Expected "${str}" but found "${found}..." at position ${this.position}`
      )
    }
  }
}

export function parseSignature(input: string): ParsedSignature {
  const parser = new SignatureParser(input)
  return parser.parse()
}
