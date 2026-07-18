import { describe, expect, it } from 'vitest';

import { parseSignature } from './parser.js';

describe('SignatureParser', () => {
  describe('basic parsing', () => {
    it('parses a simple signature without description', () => {
      const sig = parseSignature('userQuestion:string -> modelAnswer:number');

      expect(sig.desc).toBeUndefined();
      expect(sig.inputs).toHaveLength(1);
      expect(sig.outputs).toHaveLength(1);

      const input0 = sig.inputs[0] as {
        name: string;
        type: { name: string; isArray: boolean };
        isOptional: boolean;
        desc?: string;
      };
      const output0 = sig.outputs[0] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };

      expect(input0).toEqual({
        name: 'userQuestion',
        type: { name: 'string', isArray: false },
        isOptional: undefined,
        desc: undefined,
      });

      expect(output0).toEqual({
        name: 'modelAnswer',
        type: { name: 'number', isArray: false },
        isOptional: false,
        isInternal: false,
        desc: undefined,
      });
    });

    it('parses a signature with description', () => {
      const sig = parseSignature(
        '"This is a test" userQuestion:string -> modelAnswer:number'
      );

      expect(sig.desc).toBe('This is a test');
      expect(sig.inputs).toHaveLength(1);
      expect(sig.outputs).toHaveLength(1);
    });
  });

  describe('field descriptions', () => {
    it('parses fields with descriptions', () => {
      const sig = parseSignature(
        'userQuestion:string "input description" -> modelAnswer:number "output description"'
      );

      const input0 = sig.inputs[0] as {
        name: string;
        type: { name: string; isArray: boolean };
        isOptional: boolean;
        desc?: string;
      };
      const output0 = sig.outputs[0] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };

      expect(input0.desc).toBe('input description');
      expect(output0.desc).toBe('output description');
    });

    it('handles both single and double quoted descriptions', () => {
      const sig = parseSignature(
        'userQuestion:string "double quotes", userParam:number \'single quotes\' -> modelAnswer:string "result"'
      );

      const input0 = sig.inputs[0] as {
        name: string;
        type: { name: string; isArray: boolean };
        isOptional: boolean;
        desc?: string;
      };
      const input1 = sig.inputs[1] as {
        name: string;
        type: { name: string; isArray: boolean };
        isOptional: boolean;
        desc?: string;
      };
      const output0 = sig.outputs[0] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };

      expect(input0.desc).toBe('double quotes');
      expect(input1.desc).toBe('single quotes');
      expect(output0.desc).toBe('result');
    });
  });

  describe('optional fields', () => {
    it('parses optional input fields', () => {
      const sig = parseSignature(
        'requiredField:string, optionalField?:number -> modelAnswer:string'
      );

      const input0 = sig.inputs[0] as {
        name: string;
        type: { name: string; isArray: boolean };
        isOptional: boolean;
        desc?: string;
      };
      const input1 = sig.inputs[1] as {
        name: string;
        type: { name: string; isArray: boolean };
        isOptional: boolean;
        desc?: string;
      };

      expect(input0.isOptional).toBe(undefined);
      expect(input1.isOptional).toBe(true);
    });

    it('parses optional output fields', () => {
      const sig = parseSignature(
        'userQuestion:string -> requiredField:string, optionalField?:number'
      );

      const output0 = sig.outputs[0] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };
      const output1 = sig.outputs[1] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };

      expect(output0.isOptional).toBe(false);
      expect(output1.isOptional).toBe(true);
    });
  });

  describe('internal marker', () => {
    it('parses output field with internal marker', () => {
      const sig = parseSignature('userQuestion:string -> modelAnswer!:number');
      const output0 = sig.outputs[0] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };
      expect(output0.isInternal).toBe(true);
    });

    it('parses output field with both optional and internal markers', () => {
      const sig = parseSignature('userQuestion:string -> modelAnswer?!:number');
      const output0 = sig.outputs[0] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };
      expect(output0.isOptional).toBe(true);
      expect(output0.isInternal).toBe(true);
    });

    it('throws error for input field with internal marker', () => {
      expect(() =>
        parseSignature('userQuestion!:string -> modelAnswer:number')
      ).toThrow(/cannot use the internal marker/);
    });
  });

  describe('array types', () => {
    it('parses array types', () => {
      const sig = parseSignature(
        'userQuestions:string[] -> modelAnswers:number[]'
      );

      const input0 = sig.inputs[0] as {
        name: string;
        type: { name: string; isArray: boolean };
        isOptional: boolean;
        desc?: string;
      };
      const output0 = sig.outputs[0] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };

      expect(input0.type?.isArray).toBe(true);
      expect(output0.type?.isArray).toBe(true);
    });

    it('handles mix of array and non-array types', () => {
      const sig = parseSignature(
        'userQuestion:string, userQuestions:number[] -> modelAnswers:boolean[]'
      );

      const input0 = sig.inputs[0] as {
        name: string;
        type: { name: string; isArray: boolean };
        isOptional: boolean;
        desc?: string;
      };
      const input1 = sig.inputs[1] as {
        name: string;
        type: { name: string; isArray: boolean };
        isOptional: boolean;
        desc?: string;
      };
      const output0 = sig.outputs[0] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };

      expect(input0.type?.isArray).toBe(false);
      expect(input1.type?.isArray).toBe(true);
      expect(output0.type?.isArray).toBe(true);
    });
  });

  describe('class types', () => {
    it('parses class types with single class', () => {
      const sig = parseSignature(
        'userQuestion:string -> categoryType:class "option1, option2"'
      );

      const output0 = sig.outputs[0] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };

      expect(output0.type?.name).toBe('class');
      if (output0.type?.name === 'class') {
        const classType = output0.type as {
          name: 'class';
          isArray: boolean;
          options: string[];
        };
        expect(classType.options).toEqual(['option1', 'option2']);
      }
    });

    it('parses class types with multiple options', () => {
      const sig = parseSignature(
        'userQuestion:string -> categoryType:class "positive, negative, neutral"'
      );

      const output0 = sig.outputs[0] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };

      expect(output0.type?.name).toBe('class');
      if (output0.type?.name === 'class') {
        const classType = output0.type as {
          name: 'class';
          isArray: boolean;
          options: string[];
        };
        expect(classType.options).toEqual(['positive', 'negative', 'neutral']);
      }
    });

    it('handles array of options', () => {
      const sig = parseSignature(
        'userQuestion:string -> categoryTypes:class[] "option1, option2"'
      );

      const output0 = sig.outputs[0] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };

      expect(output0.type?.name).toBe('class');
      expect(output0.type?.isArray).toBe(true);
      if (output0.type?.name === 'class') {
        const classType = output0.type as {
          name: 'class';
          isArray: boolean;
          options: string[];
        };
        expect(classType.options).toEqual(['option1', 'option2']);
      }
    });

    it('throws error for input field with class type', () => {
      expect(() =>
        parseSignature('categoryType:class "a,b" -> modelAnswer:string')
      ).toThrow(/cannot use the "class" type/);
    });

    it('throws error for missing class options', () => {
      expect(() =>
        parseSignature('userQuestion:string -> categoryType:class ""')
      ).toThrow(/Missing class options/);
    });

    it('parses class types with pipe separator', () => {
      const sig = parseSignature(
        'userQuestion:string -> categoryType:class "option1 | option2 | option3"'
      );

      const output0 = sig.outputs[0] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };

      expect(output0.type?.name).toBe('class');
      if (output0.type?.name === 'class') {
        const classType = output0.type as {
          name: 'class';
          isArray: boolean;
          options: string[];
        };
        expect(classType.options).toEqual(['option1', 'option2', 'option3']);
      }
    });

    it('parses class types with mixed separators', () => {
      const sig = parseSignature(
        'userQuestion:string -> categoryType:class "option1, option2 | option3"'
      );

      const output0 = sig.outputs[0] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };

      expect(output0.type?.name).toBe('class');
      if (output0.type?.name === 'class') {
        const classType = output0.type as {
          name: 'class';
          isArray: boolean;
          options: string[];
        };
        expect(classType.options).toEqual(['option1', 'option2', 'option3']);
      }
    });

    it('parses class options with mixed separators and spacing', () => {
      const sig = parseSignature(
        'userQuestion:string -> categoryType:class "valid, option,with,comma"'
      );

      const output0 = sig.outputs[0] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };

      expect(output0.type?.name).toBe('class');
      if (output0.type?.name === 'class') {
        const classType = output0.type as {
          name: 'class';
          isArray: boolean;
          options: string[];
        };
        expect(classType.options).toEqual(['valid', 'option', 'with', 'comma']);
      }
    });

    it('parses class options with pipe separators and mixed spacing', () => {
      const sig = parseSignature(
        'userQuestion:string -> categoryType:class "valid | option|with|pipe"'
      );

      const output0 = sig.outputs[0] as {
        name: string;
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] };
        isOptional: boolean;
        isInternal: boolean;
        desc?: string;
      };

      expect(output0.type?.name).toBe('class');
      if (output0.type?.name === 'class') {
        const classType = output0.type as {
          name: 'class';
          isArray: boolean;
          options: string[];
        };
        expect(classType.options).toEqual(['valid', 'option', 'with', 'pipe']);
      }
    });
  });

  describe('duplicate fields', () => {
    it('throws error for duplicate input fields', () => {
      expect(() =>
        parseSignature(
          'userQuestion:string, userQuestion:number -> modelAnswer:string'
        )
      ).toThrow(/Duplicate input field name/);
    });

    it('throws error for duplicate output fields', () => {
      expect(() =>
        parseSignature(
          'userQuestion:string -> modelAnswer:string, modelAnswer:number'
        )
      ).toThrow(/Duplicate output field name/);
    });

    it('throws error for fields in both input and output', () => {
      expect(() =>
        parseSignature('userQuestion:string -> userQuestion:string')
      ).toThrow(/appears in both inputs and outputs/);
    });
  });

  describe('error cases', () => {
    it('throws on empty signature', () => {
      expect(() => parseSignature('')).toThrow('Empty signature provided');
    });

    it('throws on missing arrow', () => {
      expect(() =>
        parseSignature('userQuestion:string modelAnswer:string')
      ).toThrow('Expected "->"');
    });

    it('throws on missing output fields', () => {
      expect(() => parseSignature('userQuestion:string ->')).toThrow(
        'No output fields specified'
      );
    });

    it('throws on invalid type', () => {
      expect(() =>
        parseSignature('userQuestion:invalid -> modelAnswer:string')
      ).toThrow('Invalid type "invalid"');
    });

    it('throws on unterminated string', () => {
      expect(() =>
        parseSignature(
          'userQuestion:string "unterminated -> modelAnswer:string'
        )
      ).toThrow('Unterminated string');
    });

    it('throws on unexpected content after signature', () => {
      expect(() =>
        parseSignature(
          'userQuestion:string -> modelAnswer:string extra content'
        )
      ).toThrow('Unexpected content after signature');
    });

    it('throws on invalid field name characters', () => {
      expect(() =>
        parseSignature('invalid-name:string -> modelAnswer:string')
      ).toThrow('Expected "->"');
    });

    it('throws on field names starting with numbers', () => {
      expect(() =>
        parseSignature('1name:string -> modelAnswer:string')
      ).toThrow('cannot start with a number');
    });
  });

  describe('whitespace handling', () => {
    [
      'userQuestion:string -> modelAnswer:number',
      ' userQuestion:string -> modelAnswer:number',
      'userQuestion:string -> modelAnswer:number ',
      ' userQuestion:string  ->  modelAnswer:number ',
      '\tuserQuestion:string -> modelAnswer:number\n',
    ].forEach((sigStr) => {
      it(`handles various whitespace patterns for signature: "${sigStr}"`, () => {
        const sig = parseSignature(sigStr);
        expect(sig.inputs).toHaveLength(1);
        expect(sig.outputs).toHaveLength(1);
        expect(sig.inputs[0]?.name).toBe('userQuestion');
        expect(sig.outputs[0]?.name).toBe('modelAnswer');
      });
    });
  });
});

describe('SignatureParser — modifier bags', () => {
  it('parses min/max on string as length constraints', () => {
    const sig = parseSignature(
      'userName:string(min 2, max 50) -> replyText:string'
    );
    expect(sig.inputs[0]?.type).toEqual({
      name: 'string',
      isArray: false,
      minLength: 2,
      maxLength: 50,
    });
  });

  it('parses min/max on number as value constraints incl. floats and negatives', () => {
    const sig = parseSignature(
      'tempCelsius:number(min -40.5, max 60.25) -> replyText:string'
    );
    expect(sig.inputs[0]?.type).toEqual({
      name: 'number',
      isArray: false,
      minimum: -40.5,
      maximum: 60.25,
    });
  });

  it('parses all format values', () => {
    const sig = parseSignature(
      'contactEmail:string(format email), siteLink:string(format uri), bornOn:string(format date), seenAt:string(format date-time) -> replyText:string'
    );
    expect(sig.inputs.map((i) => i.type?.format)).toEqual([
      'email',
      'uri',
      'date',
      'date-time',
    ]);
  });

  it('parses pattern with and without a pattern description', () => {
    // Quoted strings use backslash escaping, so a regex "\d" is written "\\d"
    // in the signature text (same rule as descriptions).
    const sig = parseSignature(
      'userName:string(pattern "^[a-z_]+$" "lowercase identifier"), skuCode:string(pattern "^[A-Z]{3}-\\\\d+$") -> replyText:string'
    );
    expect(sig.inputs[0]?.type?.pattern).toBe('^[a-z_]+$');
    expect(sig.inputs[0]?.type?.patternDescription).toBe(
      'lowercase identifier'
    );
    expect(sig.inputs[1]?.type?.pattern).toBe('^[A-Z]{3}-\\d+$');
    expect(sig.inputs[1]?.type?.patternDescription).toBeUndefined();
  });

  it('parses cache on a top-level input field', () => {
    const sig = parseSignature(
      'contextText:string(cache) "shared context" -> replyText:string'
    );
    expect(sig.inputs[0]?.isCached).toBe(true);
    expect(sig.inputs[0]?.type).toEqual({ name: 'string', isArray: false });
  });

  it('parses item descriptions bound to arrays', () => {
    const sig = parseSignature(
      'tagList:string(item "a short tag")[] "all tags" -> replyText:string'
    );
    expect(sig.inputs[0]?.type).toEqual({
      name: 'string',
      isArray: true,
      description: 'a short tag',
    });
    expect(sig.inputs[0]?.desc).toBe('all tags');
  });

  it('parses code language and mirrors it into the description', () => {
    const sig = parseSignature('codeSnippet:code(python) -> replyText:string');
    expect(sig.inputs[0]?.type?.language).toBe('python');
    expect(sig.inputs[0]?.desc).toBe('python');
  });

  it('keeps an explicit description over the code language', () => {
    const sig = parseSignature(
      'codeSnippet:code(python) "script to run" -> fixedSnippet:code(typescript)'
    );
    expect(sig.inputs[0]?.desc).toBe('script to run');
    expect(sig.inputs[0]?.type?.language).toBe('python');
    expect(sig.outputs[0]?.desc).toBe('typescript');
  });

  it('binds the bag before the array suffix', () => {
    const sig = parseSignature(
      'scoreList:number(min 0, max 10)[] -> replyText:string'
    );
    expect(sig.inputs[0]?.type).toEqual({
      name: 'number',
      isArray: true,
      minimum: 0,
      maximum: 10,
    });
  });
});

describe('SignatureParser — nested object types', () => {
  it('parses a simple object with defaults and optional fields', () => {
    const sig = parseSignature(
      'profileInfo:object{ id:string, age?:number "in years", nickName } -> replyText:string'
    );
    expect(sig.inputs[0]?.type?.name).toBe('object');
    expect(sig.inputs[0]?.type?.fields).toEqual({
      id: {
        type: 'string',
        isArray: false,
        isOptional: false,
        isInternal: false,
      },
      age: {
        type: 'number',
        isArray: false,
        isOptional: true,
        isInternal: false,
        description: 'in years',
      },
      nickName: {
        type: 'string',
        isArray: false,
        isOptional: false,
        isInternal: false,
      },
    });
  });

  it('parses nested class fields with options in outputs and inputs', () => {
    const sig = parseSignature(
      'requestInfo:object{ severity:class "high, low" } -> reviewInfo:object{ verdictNote:string, level:class[] "a | b | c" }'
    );
    expect(sig.inputs[0]?.type?.fields?.severity).toEqual({
      type: 'class',
      isArray: false,
      options: ['high', 'low'],
      isOptional: false,
      isInternal: false,
    });
    const outType = sig.outputs[0]?.type;
    expect(outType && 'fields' in outType && outType.fields?.level).toEqual({
      type: 'class',
      isArray: true,
      options: ['a', 'b', 'c'],
      isOptional: false,
      isInternal: false,
    });
  });

  it('parses arrays of objects and two-level nesting', () => {
    const sig = parseSignature(
      'orderInfo:object{ lineItems:object{ sku:string, qty:number }[], notes:string[] }[] -> replyText:string'
    );
    const type = sig.inputs[0]?.type;
    expect(type?.name).toBe('object');
    expect(type?.isArray).toBe(true);
    expect(type?.fields?.lineItems).toEqual({
      type: 'object',
      isArray: true,
      isOptional: false,
      isInternal: false,
      fields: {
        sku: {
          type: 'string',
          isArray: false,
          isOptional: false,
          isInternal: false,
        },
        qty: {
          type: 'number',
          isArray: false,
          isOptional: false,
          isInternal: false,
        },
      },
    });
    expect(type?.fields?.notes).toEqual({
      type: 'string',
      isArray: true,
      isOptional: false,
      isInternal: false,
    });
  });

  it('keeps bare object as a flexible type without fields', () => {
    const sig = parseSignature('metaInfo:object -> replyText:string');
    expect(sig.inputs[0]?.type).toEqual({ name: 'object', isArray: false });
  });

  it('allows constraint bags inside objects', () => {
    const sig = parseSignature(
      'profileInfo:object{ userAge:number(min 0), mail:string(format email), snip:code(python) } -> replyText:string'
    );
    expect(sig.inputs[0]?.type?.fields?.userAge?.minimum).toBe(0);
    expect(sig.inputs[0]?.type?.fields?.mail?.format).toBe('email');
    expect(sig.inputs[0]?.type?.fields?.snip).toEqual({
      type: 'code',
      isArray: false,
      language: 'python',
      description: 'python',
      isOptional: false,
      isInternal: false,
    });
  });
});

describe('SignatureParser — extended grammar errors', () => {
  const cases: [string, string, RegExp][] = [
    [
      'min on boolean',
      'okFlag:boolean(min 1) -> replyText:string',
      /"min" is not supported for type "boolean"/,
    ],
    [
      'format on date',
      'bornOn:date(format email) -> replyText:string',
      /"format" is not supported for type "date"/,
    ],
    [
      'min on code',
      'codeSnippet:code(min 3) -> replyText:string',
      /"min" is not supported for type "code"/,
    ],
    [
      'unknown bare word for non-code type',
      'userName:string(python) -> replyText:string',
      /unknown modifier "python" for type "string"/,
    ],
    [
      'min without a number',
      'userAge:number(min abc) -> replyText:string',
      /"min" requires a numeric value/,
    ],
    [
      'duplicate modifier',
      'userAge:number(min 1, min 2) -> replyText:string',
      /duplicate "min" modifier/,
    ],
    [
      'empty bag',
      'userName:string() -> replyText:string',
      /empty modifier list/,
    ],
    [
      'trailing comma in bag',
      'userName:string(min 2, ) -> replyText:string',
      /trailing comma in modifier list/,
    ],
    [
      'bag on class',
      'userQuestion:string -> verdictLabel:class(min 1) "a, b"',
      /constraints are not supported on class fields/,
    ],
    [
      'unknown format',
      'contactEmail:string(format phone) -> replyText:string',
      /unknown format "phone"/,
    ],
    [
      'pattern without quotes',
      'userName:string(pattern abc) -> replyText:string',
      /"pattern" requires a quoted regular expression/,
    ],
    [
      'item without array suffix',
      'tagList:string(item "x") -> replyText:string',
      /"item" modifier requires an array type/,
    ],
    [
      'cache on output',
      'userQuestion:string -> replyText:string(cache)',
      /"cache" is only supported on top-level input fields/,
    ],
    [
      'cache inside object',
      'profileInfo:object{ ctx:string(cache) } -> replyText:string',
      /"cache" is only supported on top-level input fields/,
    ],
    [
      'item inside object',
      'profileInfo:object{ tags:string(item "x")[] } -> replyText:string',
      /"item" is not supported inside object fields/,
    ],
    [
      'image inside object (input)',
      'profileInfo:object{ photo:image } -> replyText:string',
      /image type is not allowed in nested object fields/,
    ],
    [
      'audio inside object (output)',
      'userQuestion:string -> reportInfo:object{ clip:audio }',
      /audio type is not allowed in nested object fields/,
    ],
    [
      'internal marker inside object',
      'userQuestion:string -> reportInfo:object{ scratch!:string }',
      /cannot use the internal marker/,
    ],
    [
      'unbalanced brace at end of input',
      'profileInfo:object{ id:string',
      /unbalanced "\{" in object type/,
    ],
    [
      'unclosed object before arrow',
      'profileInfo:object{ id:string -> replyText:string',
      /expected "," or "\}" in object type/,
    ],
    [
      'empty object',
      'profileInfo:object{} -> replyText:string',
      /object type requires at least one field/,
    ],
    [
      'trailing comma in object',
      'profileInfo:object{ id:string, } -> replyText:string',
      /trailing comma in object type/,
    ],
    [
      'duplicate object field',
      'profileInfo:object{ id:string, id:number } -> replyText:string',
      /duplicate object field name "id"/,
    ],
    [
      'nested class without options',
      'userQuestion:string -> reportInfo:object{ level:class }',
      /Missing class options/,
    ],
    [
      'word boundary on type names',
      'answerText:stringy -> replyText:string',
      /Invalid type "stringy"/,
    ],
  ];

  for (const [label, signature, matcher] of cases) {
    it(`rejects ${label}`, () => {
      expect(() => parseSignature(signature)).toThrow(matcher);
    });
  }
});
