import type { AxFunction, AxFunctionJSONSchema } from '../ai/types.js';
import type { AxIField } from './sig.js';

/**
 * Converts tool schemas to signature fields for signature tool calling
 */
export class ToolSchemaConverter {
  /**
   * Convert a tool schema to a signature field
   */
  convert(tool: AxFunction): { fieldName: string; field: AxIField } {
    const fieldName = this.sanitizeFieldName(tool.name);
    const fieldType = this.inferToolFieldType(tool.parameters);

    return {
      fieldName,
      field: {
        name: fieldName,
        title: this.formatTitle(tool.name),
        type: fieldType,
        description: tool.description || `Result from ${tool.name}`,
        isOptional: true,
      },
    };
  }

  /**
   * Convert multiple tools to signature fields
   */
  convertAll(tools: AxFunction[]): AxIField[] {
    return tools.map((tool) => this.convert(tool).field);
  }

  /**
   * Generate signature string for tool fields
   */
  generateSignatureString(tools: AxFunction[]): string {
    const fields = this.convertAll(tools);
    return fields
      .map(
        (field) =>
          `${field.name}?:${this.getTypeString(field.type!)} "${field.description}"`
      )
      .join(', ');
  }

  private sanitizeFieldName(name: string): string {
    // Convert camelCase/PascalCase to snake_case
    return name
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_|_$/g, '')
      .replace(/[^a-z0-9_]/g, '_');
  }

  private formatTitle(name: string): string {
    // Convert camelCase to Title Case
    return name
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  }

  private inferToolFieldType(parameters?: AxFunctionJSONSchema) {
    if (
      !parameters ||
      !parameters.properties ||
      Object.keys(parameters.properties).length === 0
    ) {
      return { name: 'string' as const, isArray: false };
    }

    // For tools with parameters, use JSON type to capture the arguments
    return { name: 'json' as const, isArray: false };
  }

  private getTypeString(type: { name: string; isArray?: boolean }): string {
    const typeMap: Record<string, string> = {
      string: 'string',
      number: 'number',
      boolean: 'boolean',
      json: 'json',
      array: 'string[]',
    };
    return typeMap[type.name] || 'string';
  }
}
