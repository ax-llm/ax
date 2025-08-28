import type { AxFunction } from '../ai/types.js';
import { ValidationError } from './errors.js';
import type { AxChatResponseFunctionCall } from './functions.js';
import type { AxField } from './sig.js';

export interface SignatureToolRouterResult {
  functionCalls: AxChatResponseFunctionCall[];
  remainingFields: Record<string, unknown>;
}

/**
 * Routes LLM output to tools based on populated optional fields
 */
export class SignatureToolRouter {
  private tools: Map<string, AxFunction>;
  private logger?: ((message: string) => void) | undefined;

  constructor(
    tools: AxFunction[],
    logger?: ((message: string) => void) | undefined
  ) {
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
    this.logger = logger;
  }

  /**
   * Build and return a map of tool name -> (full param path -> AxField)
   * Used by signature tooling to inject tool parameter fields.
   */
  public getToolParamFieldMap(): Map<string, Map<string, AxField>> {
    const toolParamFieldMap = new Map<string, Map<string, AxField>>();
    for (const [, tool] of this.tools.entries()) {
      if (
        tool.parameters?.properties &&
        Object.keys(tool.parameters.properties).length > 0
      ) {
        const { paramFieldMap } = _generateToolParameterFields(tool);
        toolParamFieldMap.set(tool.name, paramFieldMap);
      } else {
        toolParamFieldMap.set(tool.name, new Map());
      }
    }
    return toolParamFieldMap;
  }

  /**
   * Process results and return function calls for populated tool fields
   */
  async route(
    results: Record<string, unknown>,
    _options?: { sessionId?: string; traceId?: string }
  ): Promise<SignatureToolRouterResult> {
    const functionCalls: AxChatResponseFunctionCall[] = [];
    const remainingFields: Record<string, unknown> = {};

    // Prepare accumulators for per-tool argument collection (from parameter fields)
    const argsByTool: Map<string, Record<string, unknown>> = new Map();

    // Precompute field maps for tools: sanitized field name -> path segments
    const fieldMaps: Map<string, Map<string, string[]>> = new Map();
    for (const [toolName, tool] of this.tools.entries()) {
      fieldMaps.set(toolName, this.buildSanitizedFieldMap(tool));
    }

    // First pass: collect plain fields and any explicit tool objects
    for (const [key, value] of Object.entries(results)) {
      const tool = this.tools.get(this.normalizeToolName(key));
      if (tool) {
        // Explicit tool object provided
        if (
          value !== undefined &&
          value !== null &&
          typeof value === 'object'
        ) {
          argsByTool.set(tool.name, value as Record<string, unknown>);
        }
        continue; // don't add to remaining yet; we'll add result after execution
      }
      remainingFields[key] = value;
    }

    // Second pass: collect parameter-style fields (e.g., search_web_query)
    for (const [key, value] of Object.entries(results)) {
      // For each tool, check if key matches a sanitized parameter field
      for (const [toolName, tool] of this.tools.entries()) {
        const fmap = fieldMaps.get(toolName);
        if (!fmap) continue;
        const path = fmap.get(key);
        if (!path) continue;
        const args = argsByTool.get(tool.name) ?? {};
        this.setNested(args, path, value);
        argsByTool.set(tool.name, args);
      }
    }

    // Build function calls for tools with collected args
    for (const [_toolName, tool] of this.tools.entries()) {
      const args = argsByTool.get(tool.name);
      if (!args || Object.keys(args).length === 0) {
        continue;
      }

      // Validate required parameters against provided args when parameters schema exists
      if (tool.parameters && tool.parameters.type === 'object') {
        const required = (tool.parameters.required as string[]) || [];
        const missing = required.filter(
          (key) => (args as Record<string, unknown>)[key] === undefined
        );
        if (missing.length > 0) {
          throw new ValidationError(
            `Missing required arguments for tool '${tool.name}': ${missing.join(', ')}`
          );
        }
      }

      functionCalls.push({
        id: tool.name,
        name: tool.name,
        args: JSON.stringify(args),
      });
    }

    // Return remaining fields and function calls (no execution here)
    return { functionCalls, remainingFields };
  }

  /**
   * Normalize tool name to match field names
   */
  private normalizeToolName(fieldName: string): string {
    // Convert snake_case back to camelCase for tool matching
    return fieldName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  private sanitizeFieldName(name: string): string {
    return name
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_|_$/g, '')
      .replace(/[^a-z0-9_]/g, '_');
  }

  private buildSanitizedFieldMap(tool: AxFunction): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (!tool.parameters || !('properties' in (tool.parameters as any))) {
      return map;
    }
    const walk = (props: Record<string, any>, prefix: string[]) => {
      for (const [key, schema] of Object.entries(props)) {
        const path = [...prefix, key];
        if (schema && schema.type === 'object' && schema.properties) {
          walk(schema.properties as Record<string, any>, path);
        } else {
          const full = `${tool.name}.${path.join('.')}`;
          const sanitized = this.sanitizeFieldName(full);
          map.set(sanitized, path);
        }
      }
    };
    walk((tool.parameters as any).properties ?? {}, []);
    return map;
  }

  private setNested(
    target: Record<string, unknown>,
    path: string[],
    value: unknown
  ) {
    let obj: Record<string, unknown> = target;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      const next = obj[k];
      if (typeof next !== 'object' || next === null) {
        obj[k] = {} as Record<string, unknown>;
      }
      obj = obj[k] as Record<string, unknown>;
    }
    obj[path[path.length - 1]] = value as unknown;
  }

  /**
   * Check if a field name corresponds to a tool
   */
  isToolField(fieldName: string): boolean {
    return this.tools.has(this.normalizeToolName(fieldName));
  }

  /**
   * Get all tool field names
   */
  getToolFieldNames(): string[] {
    return Array.from(this.tools.keys()).map((name) =>
      name
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, '')
    );
  }
}

/**
 * Generate signature fields for tool parameters using dot notation
 */
function _generateToolParameterFields(tool: AxFunction): {
  fields: AxField[];
  paramFieldMap: Map<string, AxField>;
} {
  const fields: AxField[] = [];
  const paramFieldMap = new Map<string, AxField>();

  if (!tool.parameters || !tool.parameters.properties) {
    return { fields, paramFieldMap };
  }

  const properties = tool.parameters.properties as Record<string, any>;
  const required = (tool.parameters.required as string[]) || [];

  const processProperties = (
    props: Record<string, any>,
    prefix: string,
    _parentRequired: string[]
  ) => {
    for (const [key, schema] of Object.entries(props)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      const fullName = `${tool.name}.${fieldPath}`;

      if (schema.type === 'object' && schema.properties) {
        // Recursively handle nested objects
        processProperties(schema.properties, fieldPath, schema.required || []);
      } else {
        // Create field for this parameter
        const fieldType = inferParameterType(schema);

        // All tool parameters should be optional since they're for signature tool calling
        fields.push({
          name: sanitizeFieldName(fullName),
          title: formatParameterTitle(tool.name, fieldPath),
          type: fieldType,
          description:
            schema.description || `${key} parameter for ${tool.name}`,
          isOptional: true,
        });
        paramFieldMap.set(fullName, fields[fields.length - 1]);
      }
    }
  };

  processProperties(properties, '', required);
  return { fields, paramFieldMap };
}

/**
 * Infer signature field type from JSON Schema parameter
 */
function inferParameterType(schema: any): {
  name: 'string' | 'number' | 'boolean' | 'json';
  isArray: boolean;
} {
  switch (schema.type) {
    case 'string':
      return { name: 'string', isArray: false };
    case 'number':
    case 'integer':
      return { name: 'number', isArray: false };
    case 'boolean':
      return { name: 'boolean', isArray: false };
    case 'array': {
      const items = schema.items;
      if (items?.type) {
        switch (items.type) {
          case 'string':
            return { name: 'string', isArray: true };
          case 'number':
          case 'integer':
            return { name: 'number', isArray: true };
          case 'boolean':
            return { name: 'boolean', isArray: true };
          default:
            return { name: 'json', isArray: true };
        }
      }
      return { name: 'json', isArray: true };
    }
    case 'object':
      return { name: 'json', isArray: false };
    default:
      return { name: 'string', isArray: false };
  }
}

/**
 * Format parameter title for display
 */
function formatParameterTitle(toolName: string, paramPath: string): string {
  return `${toolName} ${paramPath.replace(/\./g, ' ')}`;
}

function sanitizeFieldName(name: string): string {
  // Convert camelCase/PascalCase to snake_case
  return name
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_|_$/g, '')
    .replace(/[^a-z0-9_]/g, '_');
}

function _formatTitle(name: string): string {
  // Convert camelCase to Title Case
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}
