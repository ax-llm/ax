import type {
  AxAIModelList,
  AxAIService,
  AxFunction,
  AxFunctionHandler,
  AxFunctionJSONSchema,
} from '../ai/types.js';
import type { AxInputFunctionType } from '../dsp/functions.js';
import { AxGen } from '../dsp/generate.js';
import type { AxSignature } from '../dsp/sig.js';
import type {
  AxGenIn,
  AxGenOut,
  AxGenStreamingOut,
  AxMessage,
  AxProgramDemos,
  AxProgramExamples,
  AxProgramForwardOptions,
  AxProgramForwardOptionsWithModels,
  AxProgrammable,
  AxProgramStreamingForwardOptionsWithModels,
  AxSetExamplesOptions,
  AxTunable,
  AxUsable,
} from '../dsp/types.js';

/**
 * Interface for agents that can be used as child agents.
 * Provides methods to get the agent's function definition and features.
 */
export interface AxAgentic<IN extends AxGenIn, OUT extends AxGenOut>
  extends AxProgrammable<IN, OUT> {
  getFunction(): AxFunction;
  getFeatures(): AxAgentFeatures;
}

export type AxAgentOptions = Omit<
  AxProgramForwardOptions<string>,
  'functions'
> & {
  disableSmartModelRouting?: boolean;
  /** List of field names that should not be automatically passed from parent to child agents */
  excludeFieldsFromPassthrough?: string[];
  debug?: boolean;
};

export interface AxAgentFeatures {
  /** Whether this agent can use smart model routing (requires an AI service) */
  canConfigureSmartModelRouting: boolean;
  /** List of fields that this agent excludes from parent->child value passing */
  excludeFieldsFromPassthrough: string[];
}

/**
 * Processes a child agent's function, applying model routing and input injection as needed.
 * Handles both the schema modifications and function wrapping.
 */
function processChildAgentFunction<IN extends AxGenIn>(
  childFunction: Readonly<AxFunction>,
  parentValues: IN | AxMessage<IN>[],
  parentInputKeys: string[],
  modelList: AxAIModelList<string> | undefined,
  options: Readonly<{
    debug: boolean;
    disableSmartModelRouting: boolean;
    excludeFieldsFromPassthrough: string[];
    canConfigureSmartModelRouting: boolean;
  }>
): AxFunction {
  const processedFunction = { ...childFunction };

  // Process input field injection
  if (processedFunction.parameters) {
    const childKeys = processedFunction.parameters.properties
      ? Object.keys(processedFunction.parameters.properties)
      : [];

    // Find common keys between parent and child, excluding 'model' and specified exclusions
    const commonKeys = parentInputKeys
      .filter((key) => childKeys.includes(key))
      .filter((key) => key !== 'model');
    const injectionKeys = commonKeys.filter(
      (key) => !options.excludeFieldsFromPassthrough.includes(key)
    );

    if (injectionKeys.length > 0) {
      // Remove injected fields from child schema
      processedFunction.parameters = removePropertiesFromSchema(
        processedFunction.parameters,
        injectionKeys
      );

      // Wrap function to inject parent values
      const originalFunc = processedFunction.func;
      // add debug logging if enabled
      processedFunction.func = async (childArgs, funcOptions) => {
        // Extract values from parentValues - handle both IN and AxMessage<IN>[] cases
        let valuesToInject: Partial<IN> = {};
        if (Array.isArray(parentValues)) {
          // If parentValues is an array of messages, find the most recent user message
          const lastUserMessage = parentValues
            .filter((msg) => msg.role === 'user')
            .pop();
          if (lastUserMessage) {
            valuesToInject = pick(
              lastUserMessage.values,
              injectionKeys as (keyof IN)[]
            );
          }
        } else {
          // If parentValues is a single IN object
          valuesToInject = pick(parentValues, injectionKeys as (keyof IN)[]);
        }

        const updatedChildArgs = {
          ...childArgs,
          ...valuesToInject,
        };

        return await originalFunc(updatedChildArgs, funcOptions);
      };
    }

    return processedFunction;
  }

  // Apply smart model routing if enabled
  if (
    modelList &&
    !options.disableSmartModelRouting &&
    options.canConfigureSmartModelRouting
  ) {
    processedFunction.parameters = addModelParameter(
      processedFunction.parameters,
      modelList
    );
  }

  return processedFunction;
}

const descriptionError = new Error(
  'Agent description must be at least 20 characters (explain in detail what the agent does)'
);

const definitionError = new Error(
  'Agent definition is the prompt you give to the LLM for the agent. It must be detailed and at least 100 characters'
);

/**
 * An AI agent that can process inputs using an AI service and coordinate with child agents.
 * Supports features like smart model routing and automatic input field passing to child agents.
 */
export class AxAgent<IN extends AxGenIn, OUT extends AxGenOut>
  implements AxAgentic<IN, OUT>
{
  private ai?: AxAIService;
  private program: AxGen<IN, OUT>;
  private functions?: AxInputFunctionType;
  private agents?: AxAgentic<IN, OUT>[];
  private disableSmartModelRouting?: boolean;
  private excludeFieldsFromPassthrough: string[];
  private debug?: boolean;

  private name: string;
  //   private subAgentList?: string
  private func: AxFunction;

  /**
   * Creates an instance of the `AxAgent` class.
   *
   * @param {object} params - The parameters for creating the agent.
   * @param {Readonly<AxAIService>} [params.ai] - The AI service to use.
   * @param {string} params.name - The name of the agent.
   * @param {string} params.description - A description of the agent.
   * @param {string} [params.definition] - A detailed definition of the agent's purpose.
   * @param {NonNullable<ConstructorParameters<typeof AxSignature>[0]>} params.signature - The signature for the agent's program.
   * @param {AxAgentic<IN, OUT>[]} [params.agents] - A list of child agents.
   * @param {AxInputFunctionType} [params.functions] - A list of functions the agent can use.
   * @param {Readonly<AxAgentOptions>} [options] - The options for the agent.
   */
  constructor(
    {
      ai,
      name,
      description,
      definition,
      signature,
      agents,
      functions,
    }: Readonly<{
      ai?: Readonly<AxAIService>;
      name: string;
      description: string;
      definition?: string;
      signature: NonNullable<ConstructorParameters<typeof AxSignature>[0]>;
      agents?: AxAgentic<IN, OUT>[];
      functions?: AxInputFunctionType;
    }>,
    options?: Readonly<AxAgentOptions>
  ) {
    const { disableSmartModelRouting, excludeFieldsFromPassthrough, debug } =
      options ?? {};

    this.ai = ai;
    this.agents = agents;
    this.functions = functions;
    this.disableSmartModelRouting = disableSmartModelRouting;
    this.excludeFieldsFromPassthrough = excludeFieldsFromPassthrough ?? [];
    this.debug = debug;

    if (!name || name.length < 5) {
      throw new Error(
        'Agent name must be at least 10 characters (more descriptive)'
      );
    }

    if (!description || description.length < 20) {
      throw descriptionError;
    }

    if (definition && definition.length < 100) {
      throw definitionError;
    }

    this.program = new AxGen<IN, OUT>(signature, {
      ...options,
      description: definition ?? description,
    });

    for (const agent of agents ?? []) {
      this.program.register(
        agent as unknown as Readonly<AxTunable<IN, OUT> & AxUsable>
      );
    }

    this.name = name;
    // this.subAgentList = agents?.map((a) => a.getFunction().name).join(', ')

    this.func = {
      name: toCamelCase(this.name),
      description,
      parameters: this.program.getSignature().toJSONSchema(),
      func: () => this.forward,
    };

    const mm = ai?.getModelList();
    // Only add model parameter if smart routing is enabled and model list exists
    if (mm && !this.disableSmartModelRouting) {
      this.func.parameters = addModelParameter(this.func.parameters, mm);
    }
  }

  /**
   * Sets the examples for the agent's program.
   * @param {Readonly<AxProgramExamples<IN, OUT>>} examples - The examples to set.
   * @param {Readonly<AxSetExamplesOptions>} [options] - The options for setting the examples.
   */
  public setExamples(
    examples: Readonly<AxProgramExamples<IN, OUT>>,
    options?: Readonly<AxSetExamplesOptions>
  ) {
    this.program.setExamples(examples, options);
  }

  /**
   * Sets the ID for the agent's program.
   * @param {string} id - The ID to set.
   */
  public setId(id: string) {
    this.program.setId(id);
  }

  /**
   * Sets the parent ID for the agent's program.
   * @param {string} parentId - The parent ID to set.
   */
  public setParentId(parentId: string) {
    this.program.setParentId(parentId);
  }

  /**
   * Gets the traces for the agent's program.
   * @returns {any[]} The traces for the program.
   */
  public getTraces() {
    return this.program.getTraces();
  }

  /**
   * Sets the demos for the agent's program.
   * @param {readonly AxProgramDemos<IN, OUT>[]} demos - The demos to set.
   */
  public setDemos(demos: readonly AxProgramDemos<IN, OUT>[]) {
    this.program.setDemos(demos);
  }

  /**
   * Gets the usage for the agent's program.
   * @returns {any} The usage for the program.
   */
  public getUsage() {
    return this.program.getUsage();
  }

  /**
   * Resets the usage for the agent's program.
   */
  public resetUsage() {
    this.program.resetUsage();
  }

  /**
   * Gets the function definition for the agent.
   * @returns {AxFunction} The function definition.
   */
  public getFunction(): AxFunction {
    const boundFunc = this.forward.bind(this);

    // Create a wrapper function that excludes the 'ai' parameter
    const wrappedFunc: AxFunctionHandler = async (
      valuesAndModel: IN & { model: string },
      options?
    ): Promise<string> => {
      const { model, ...values } = valuesAndModel;

      const ai = this.ai ?? options?.ai;
      if (!ai) {
        throw new Error('AI service is required to run the agent');
      }
      const ret = await boundFunc(ai, values as unknown as IN, {
        ...options,
        model,
      });

      const sig = this.program.getSignature();
      const outFields = sig.getOutputFields();
      const result = Object.keys(ret)
        .map((k) => {
          const field = outFields.find((f) => f.name === k);
          if (field) {
            return `${field.title}: ${ret[k]}`;
          }
          return `${k}: ${ret[k]}`;
        })
        .join('\n');

      return result;
    };

    return {
      ...this.func,
      func: wrappedFunc,
    };
  }

  /**
   * Gets the features of the agent.
   * @returns {AxAgentFeatures} The features of the agent.
   */
  public getFeatures(): AxAgentFeatures {
    return {
      canConfigureSmartModelRouting: this.ai === undefined,
      excludeFieldsFromPassthrough: this.excludeFieldsFromPassthrough,
    };
  }

  /**
   * Initializes the agent's execution context, processing child agents and their functions.
   */
  private init<T extends Readonly<AxAIService>>(
    parentAi: T,
    values: IN | AxMessage<IN>[],
    options: Readonly<AxProgramForwardOptionsWithModels<T>> | undefined
  ) {
    const ai = this.ai ?? parentAi;
    const mm = ai?.getModelList();

    // Get parent's input schema and keys
    const parentSchema = this.program.getSignature().getInputFields();
    const parentKeys = parentSchema.map((p) => p.name);
    const debug = this.getDebug<T>(ai, options);

    // Process each child agent's function
    const agentFuncs = this.agents?.map((agent) => {
      const f = agent.getFeatures();

      const processOptions = {
        debug,
        disableSmartModelRouting: !!this.disableSmartModelRouting,
        excludeFieldsFromPassthrough: f.excludeFieldsFromPassthrough,
        canConfigureSmartModelRouting: f.canConfigureSmartModelRouting,
      };

      return processChildAgentFunction(
        agent.getFunction(),
        values,
        parentKeys,
        mm,
        processOptions
      );
    });

    // Combine all functions
    const functions: AxInputFunctionType = [
      ...(options?.functions ?? this.functions ?? []),
      ...(agentFuncs ?? []),
    ];

    return { ai, functions, debug };
  }

  /**
   * Executes the agent's program with the given AI service and input values.
   *
   * @param {T} parentAi - The AI service to use.
   * @param {IN | AxMessage<IN>[]} values - The input values for the agent.
   * @param {Readonly<AxProgramForwardOptionsWithModels<T>>} [options] - The options for the forward pass.
   * @returns {Promise<OUT>} A promise that resolves to the output of the agent.
   */
  public async forward<T extends Readonly<AxAIService>>(
    parentAi: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramForwardOptionsWithModels<T>>
  ): Promise<OUT> {
    const { ai, functions, debug } = this.init<T>(parentAi, values, options);
    return await this.program.forward(ai, values, {
      ...options,
      debug,
      functions,
    });
  }

  /**
   * Executes the agent's program and returns a streaming output.
   *
   * @param {T} parentAi - The AI service to use.
   * @param {IN | AxMessage<IN>[]} values - The input values for the agent.
   * @param {Readonly<AxProgramStreamingForwardOptionsWithModels<T>>} [options] - The options for the streaming forward pass.
   * @returns {AxGenStreamingOut<OUT>} A streaming output of the agent's result.
   */
  public async *streamingForward<T extends Readonly<AxAIService>>(
    parentAi: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramStreamingForwardOptionsWithModels<T>>
  ): AxGenStreamingOut<OUT> {
    const { ai, functions, debug } = this.init<T>(parentAi, values, options);
    return yield* this.program.streamingForward(ai, values, {
      ...options,
      debug,
      functions,
    });
  }

  /**
   * Updates the agent's description.
   * This updates both the stored description and the function's description.
   *
   * @param description - New description for the agent (must be at least 20 characters)
   * @throws Error if description is too short
   */
  /**
   * Updates the agent's description.
   * This updates both the stored description and the function's description.
   *
   * @param {string} description - New description for the agent (must be at least 20 characters).
   * @throws {Error} If the description is too short.
   */
  public setDescription(description: string): void {
    if (!description || description.length < 20) {
      throw descriptionError;
    }

    this.program.getSignature().setDescription(description);
    this.func.description = description;
  }

  /**
   * Updates the agent's definition.
   *
   * @param {string} definition - New definition for the agent (must be at least 100 characters).
   * @throws {Error} If the definition is too short.
   */
  public setDefinition(definition: string): void {
    if (!definition || definition.length < 100) {
      throw definitionError;
    }

    this.program.setDescription(definition);
    this.func.description = definition;
  }

  /**
   * Gets the signature of the agent's program.
   * @returns {AxSignature} The signature of the program.
   */
  public getSignature(): AxSignature {
    return this.program.getSignature();
  }

  /**
   * Sets the signature of the agent's program.
   * @param {NonNullable<ConstructorParameters<typeof AxSignature>[0]>} signature - The new signature for the program.
   */
  public setSignature(
    signature: NonNullable<ConstructorParameters<typeof AxSignature>[0]>
  ) {
    this.program.setSignature(signature);
  }

  private getDebug<T extends Readonly<AxAIService>>(
    ai: AxAIService,
    options?: Readonly<AxProgramForwardOptionsWithModels<T>>
  ): boolean {
    return options?.debug ?? this.debug ?? ai?.getOptions()?.debug ?? false;
  }
}

function toCamelCase(inputString: string): string {
  // Split the string by any non-alphanumeric character (including underscores, spaces, hyphens)
  const words = inputString.split(/[^a-zA-Z0-9]/);

  // Map through each word, capitalize the first letter of each word except the first word
  const camelCaseString = words
    .map((word, index) => {
      // Lowercase the word to handle cases like uppercase letters in input
      const lowerWord = word.toLowerCase();

      // Capitalize the first letter of each word except the first one
      if (index > 0 && lowerWord && lowerWord[0]) {
        return lowerWord[0].toUpperCase() + lowerWord.slice(1);
      }

      return lowerWord;
    })
    .join('');

  return camelCaseString;
}

/**
 * Adds a required model parameter to a JSON Schema definition based on provided model mappings.
 * The model parameter will be an enum with values from the model map keys.
 *
 * @param parameters - The original JSON Schema parameters definition (optional)
 * @param models - Array of model mappings containing keys, model names and descriptions
 * @returns Updated JSON Schema with added model parameter
 */
export function addModelParameter(
  parameters: AxFunctionJSONSchema | undefined,
  models: AxAIModelList<string>
): AxFunctionJSONSchema {
  // If parameters is undefined, create a base schema
  const baseSchema: AxFunctionJSONSchema = parameters
    ? structuredClone(parameters)
    : {
        type: 'object',
        properties: {},
        required: [],
      };

  // Check if model parameter already exists
  if (baseSchema.properties?.model) {
    return baseSchema;
  }

  // Create the model property schema
  const modelProperty: AxFunctionJSONSchema & {
    enum: string[];
    description: string;
  } = {
    type: 'string',
    enum: models.map((m) => m.key),
    description: `The AI model to use for this function call. Available options: ${models
      .map((m) => `\`${m.key}\` ${m.description}`)
      .join(', ')}`,
  };

  // Create new properties object with model parameter
  const newProperties = {
    ...(baseSchema.properties ?? {}),
    model: modelProperty,
  };

  // Add model to required fields
  const newRequired = [...(baseSchema.required ?? []), 'model'];

  // Return updated schema
  return {
    ...baseSchema,
    properties: newProperties,
    required: newRequired,
  };
}

// New helper: removePropertiesFromSchema
//    Clones a JSON schema and removes properties and required fields matching the provided keys.
function removePropertiesFromSchema(
  schema: Readonly<AxFunctionJSONSchema>,
  keys: string[]
): AxFunctionJSONSchema {
  const newSchema = structuredClone(schema);
  if (newSchema.properties) {
    for (const key of keys) {
      delete newSchema.properties[key];
    }
  }
  if (Array.isArray(newSchema.required)) {
    const filteredRequired = newSchema.required.filter(
      (r: string) => !keys.includes(r)
    );
    Object.defineProperty(newSchema, 'required', {
      value: filteredRequired,
      writable: true,
      configurable: true,
    });
  }
  return newSchema;
}

// New helper: pick
//    Returns an object composed of the picked object properties.
function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}
