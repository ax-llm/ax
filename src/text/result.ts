import Ajv, { JSONSchemaType } from 'ajv';
import JSON5 from 'json5';

import { AIPromptConfig, AIService, GenerateTextExtraOptions } from './types';

const ajv = new Ajv();

export async function parseResult<T>(
  ai: AIService,
  conf: Readonly<AIPromptConfig>,
  options: Readonly<GenerateTextExtraOptions>,
  value: string,
  keyValue = false,
  schema?: Readonly<JSONSchemaType<T>>
): Promise<string | Map<string, string[]> | T> {
  const retryCount = 5;

  for (let i = 0; i < retryCount; i++) {
    try {
      if (keyValue) {
        return stringToMap(value);
      } else if (schema) {
        const result = stringToObject<T>(value, schema) as T;
        return result;
      } else {
        return value;
      }
    } catch (e: unknown) {
      const { message } = e as Error;

      const step = ai.getTraceStep();
      if (step) {
        step.response.parsingError = { message, value };
      }

      if (i === retryCount - 1) {
        break;
      }

      const fixedValue = await fixResultSyntax<T>(
        ai,
        conf,
        message,
        value,
        options,
        schema
      );
      value = fixedValue;
    }
  }

  throw { message: `Unable to fix result syntax`, value };
}

const fixResultSyntax = async <T>(
  ai: AIService,
  md: Readonly<AIPromptConfig>,
  errorMessage: Readonly<string>,
  value: string,
  { sessionId }: Readonly<GenerateTextExtraOptions>,
  expectedSchema?: Readonly<JSONSchemaType<T>>
): Promise<string> => {
  let prompt = [
    `Result JSON:\n"""${value}"""`,
    `Syntax error in result JSON:\n${errorMessage}`,
  ];

  const jschema = JSON.stringify(expectedSchema, null, 2);

  if (expectedSchema) {
    prompt = [
      ...prompt,
      `Expected result must follow below JSON-Schema:\n${jschema}`,
      `Result JSON:`,
    ];
  }

  const res = await ai.generate(prompt.join('\n\n'), md, sessionId);
  const fixedValue = res.results.at(0)?.text?.trim() ?? '';

  if (fixedValue.length === 0) {
    throw { message: 'Empty response received', value };
  }

  return fixedValue;
};

const stringToMap = (text: string): Map<string, string[]> => {
  const vm = new Map<string, string[]>();
  const re = /([a-zA-Z ]+):\s{0,}\n?(((?!N\/A).)+)$/gm;

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // This is necessary to avoid infinite loops with zero-width matches
    if (m.index === re.lastIndex) {
      re.lastIndex++;
    }
    vm.set(m[1], m[2].split(','));
  }
  if (vm.size === 0) {
    throw { message: 'Expected format is a list of key: value', value: text };
  }
  return vm;
};

export function stringToObject<T>(
  text: string,
  schema: Readonly<JSONSchemaType<T>>
): T {
  let obj: T;

  try {
    obj = JSON5.parse<T>(text);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    throw new Error((e as Error).message.replace(/^JSON5:/, ''));
  }

  const valid = ajv.validate(schema, obj);
  if (!valid) {
    throw new Error(ajv.errorsText());
  }

  return obj as T;
}
