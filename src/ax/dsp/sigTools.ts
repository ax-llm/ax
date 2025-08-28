import type { AxFunction, AxFunctionJSONSchema } from '../ai/types.js';
import { type AxField, AxSignature } from './sig.js';
import type { SignatureToolRouter } from './signatureToolRouter.js';

/**
 * Inject tool schemas as optional output fields for signature tool calling
 * Uses dot notation for nested parameters (jq-like syntax)
 */
export function injectToolFields<
  TInput extends Record<string, any>,
  TOutput extends Record<string, any>,
>(
  tools: readonly AxFunction[],
  signature: AxSignature<TInput, TOutput>,
  router?: SignatureToolRouter
): {
  signature: AxSignature<TInput, TOutput>;
  toolParamFieldMap: Map<string, Map<string, AxField>>;
} {
  const newSig = new AxSignature(signature);

  if (router) {
    // Use the router's pre-built toolParamFieldMap
    const toolParamFieldMap = router.getToolParamFieldMap();

    for (const tool of tools) {
      const paramFieldMap = toolParamFieldMap.get(tool.name);
      if (paramFieldMap && paramFieldMap.size > 0) {
        // Add fields from the router's paramFieldMap
        for (const field of paramFieldMap.values()) {
          const exists = newSig
            .getOutputFields()
            .some((f) => f.name === field.name);
          if (!exists) {
            newSig.addOutputField(field);
          }
        }
      } else {
        // Fallback for tools without parameters or empty parameters
        const fieldName = sanitizeFieldName(tool.name);
        const fieldType = inferToolFieldType(tool.parameters);

        const exists = newSig
          .getOutputFields()
          .some((f) => f.name === fieldName);

        if (!exists) {
          newSig.addOutputField({
            name: fieldName,
            title: formatTitle(tool.name),
            type: fieldType,
            description: tool.description || `Parameters for ${tool.name}`,
            isOptional: true,
          });
        }
      }
    }

    return { signature: newSig, toolParamFieldMap };
  } else {
    // Fallback to original behavior when no router is provided
    const toolParamFieldMap = new Map<string, Map<string, AxField>>();

    for (const tool of tools) {
      if (
        tool.parameters?.properties &&
        Object.keys(tool.parameters.properties).length > 0
      ) {
        // Generate fields for each parameter using dot notation
        const { fields, paramFieldMap } = generateToolParameterFields(tool);

        toolParamFieldMap.set(tool.name, paramFieldMap);

        for (const field of fields) {
          // Check if field already exists to avoid duplicates
          const exists = newSig
            .getOutputFields()
            .some((f) => f.name === field.name);
          if (!exists) {
            newSig.addOutputField(field);
          }
        }
      } else {
        // Fallback for tools without parameters or empty parameters
        const fieldName = sanitizeFieldName(tool.name);
        const fieldType = inferToolFieldType(tool.parameters);

        const exists = newSig
          .getOutputFields()
          .some((f) => f.name === fieldName);
        if (!exists) {
          newSig.addOutputField({
            name: fieldName,
            title: formatTitle(tool.name),
            type: fieldType,
            description: tool.description || `Parameters for ${tool.name}`,
            isOptional: true,
          });
        }
      }
    }

    return { signature: newSig, toolParamFieldMap };
  }
}

/**
 * Generate signature fields for tool parameters using dot notation
 */
function generateToolParameterFields(tool: AxFunction): {
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
        const field: AxField = {
          name: sanitizeFieldName(fullName),
          title: formatParameterTitle(tool.name, fieldPath),
          type: fieldType,
          description:
            schema.description || `${key} parameter for ${tool.name}`,
          isOptional: true,
        };
        fields.push(field);
        paramFieldMap.set(fullName, field);
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

function formatTitle(name: string): string {
  // Convert camelCase to Title Case
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

function inferToolFieldType(parameters?: AxFunctionJSONSchema) {
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
