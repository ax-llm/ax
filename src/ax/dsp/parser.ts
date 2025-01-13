export type TypeNotClass =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
  | 'image'
  | 'audio'
  | 'datetime'
  | 'date'
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

  constructor(input: string) {
    this.input = input
    this.position = 0
  }

  parse(): ParsedSignature {
    this.skipWhitespace()
    const optionalDesc = this.parseParsedString()
    this.skipWhitespace()
    const inputs = this.parseInputParsedFieldList()
    this.skipWhitespace()
    this.expect('->')
    this.skipWhitespace()
    const outputs = this.parseOutputParsedFieldList()

    return {
      desc: optionalDesc?.trim(),
      inputs,
      outputs,
    }
  }

  private parseInputParsedFieldList(): InputParsedField[] {
    const fields: InputParsedField[] = []
    fields.push(this.parseInputParsedField())

    while (this.match(',')) {
      this.skipWhitespace()
      fields.push(this.parseInputParsedField())
    }

    return fields
  }

  private parseOutputParsedFieldList(): OutputParsedField[] {
    const fields: OutputParsedField[] = []
    fields.push(this.parseOutputParsedField())

    while (this.match(',')) {
      this.skipWhitespace()
      fields.push(this.parseOutputParsedField())
    }

    return fields
  }

  private parseInputParsedField(): InputParsedField {
    this.skipWhitespace()
    const name = this.parseParsedIdentifier()
    const isOptional = this.match('?')
    let type: { name: TypeNotClass; isArray: boolean } | undefined

    if (this.match(':')) {
      this.skipWhitespace()
      const typeName = this.parseTypeNotClass()
      const isArray = this.match('[]')
      type = { name: typeName, isArray }
    }

    this.skipWhitespace()
    const desc = this.parseParsedString()

    return {
      name,
      desc: desc?.trim(),
      type,
      isOptional,
    }
  }

  private parseOutputParsedField(): OutputParsedField {
    this.skipWhitespace()
    const name = this.parseParsedIdentifier()
    const isOptional = this.match('?')
    this.skipWhitespace()

    if (this.match(':')) {
      this.skipWhitespace()
      if (this.match('class')) {
        const isArray = this.match('[]')
        this.skipWhitespace()
        const desc = this.parseParsedString()
        if (!desc) {
          throw new Error(
            "Expected description containing class names after type 'class'"
          )
        }
        const classNames = desc.split(',').map((s) => s.trim())
        return {
          name,
          type: { name: 'class', isArray, classes: classNames },
          isOptional,
        }
      } else {
        const typeName = this.parseTypeNotClass()
        const isArray = this.match('[]')
        this.skipWhitespace()
        const desc = this.parseParsedString()
        return {
          name,
          desc: desc?.trim(),
          type: { name: typeName, isArray },
          isOptional,
        }
      }
    } else {
      this.skipWhitespace()
      const desc = this.parseParsedString()
      return {
        name,
        desc: desc?.trim(),
        type: undefined,
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
    ]
    for (const type of types) {
      if (this.match(type)) {
        return type
      }
    }
    throw new Error(`Expected one of ${types.join(', ')}`)
  }

  private parseParsedIdentifier(): ParsedIdentifier {
    const match = /^[a-zA-Z_][a-zA-Z_0-9]*/.exec(
      this.input.slice(this.position)
    )
    if (match) {
      this.position += match[0].length
      return match[0]
    }
    throw new Error('Expected identifier')
  }

  private parseParsedString(): string | undefined {
    if (this.match("'")) {
      const endQuote = this.input.indexOf("'", this.position)
      if (endQuote === -1) throw new Error('Unterminated string')
      const content = this.input.slice(this.position, endQuote)
      this.position = endQuote + 1
      return content
    } else if (this.match('"')) {
      const endQuote = this.input.indexOf('"', this.position)
      if (endQuote === -1) throw new Error('Unterminated string')
      const content = this.input.slice(this.position, endQuote)
      this.position = endQuote + 1
      return content
    }
    return undefined
  }

  private skipWhitespace() {
    const match = /^[ \t\r\n]+/.exec(this.input.slice(this.position))
    if (match) {
      this.position += match[0].length
    }
  }

  private match(str: string): boolean {
    if (this.input.startsWith(str, this.position)) {
      this.position += str.length
      return true
    }
    return false
  }

  private expect(str: string) {
    if (!this.match(str)) {
      throw new Error(`Expected "${str}"`)
    }
  }
}

export function parseSignature(input: string): ParsedSignature {
  const parser = new SignatureParser(input)
  return parser.parse()
}
