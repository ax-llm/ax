import type { AxField } from './sig.js';

export class ValidationError extends Error {
  private fields: AxField[];

  constructor({
    message,
    fields,
  }: Readonly<{
    message: string;
    fields: AxField[];
    value?: string;
  }>) {
    super(message);
    this.fields = fields;
    this.name = this.constructor.name;
  }

  public getFixingInstructions = () => {
    const toFieldType = (type: Readonly<AxField['type']>) => {
      const baseType = (() => {
        switch (type?.name) {
          case 'string':
            return 'string';
          case 'number':
            return 'number';
          case 'boolean':
            return 'boolean';
          case 'date':
            return 'date ("YYYY-MM-DD" format)';
          case 'datetime':
            return 'date time ("YYYY-MM-DD HH:mm Timezone" format)';
          case 'json':
            return 'JSON object';
          case 'class':
            return 'classification class';
          case 'code':
            return 'code';
          default:
            return 'string';
        }
      })();

      return type?.isArray ? `json array of ${baseType} items` : baseType;
    };

    return this.fields.map((field) => ({
      name: 'outputError',
      title: 'Output Correction Required',
      description: `The section labeled '${field.title}' does not match the expected format of '${toFieldType(field.type)}'. ${this.message} Please revise your response to ensure it conforms to the specified format.`,
    }));
  };

  override toString(): string {
    const toFieldType = (type: Readonly<AxField['type']>) => {
      const baseType = (() => {
        switch (type?.name) {
          case 'string':
            return 'string';
          case 'number':
            return 'number';
          case 'boolean':
            return 'boolean';
          case 'date':
            return 'date ("YYYY-MM-DD" format)';
          case 'datetime':
            return 'date time ("YYYY-MM-DD HH:mm Timezone" format)';
          case 'json':
            return 'JSON object';
          case 'class':
            return 'classification class';
          case 'code':
            return 'code';
          default:
            return 'string';
        }
      })();

      return type?.isArray ? `json array of ${baseType} items` : baseType;
    };

    return [
      `${this.name}: ${this.message}`,
      ...this.fields.map(
        (field) =>
          `  - ${field.title}: Expected format '${toFieldType(field.type)}'`
      ),
    ].join('\n');
  }

  [Symbol.for('nodejs.util.inspect.custom')](
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _depth: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: Record<string, unknown>
  ) {
    return this.toString();
  }
}
