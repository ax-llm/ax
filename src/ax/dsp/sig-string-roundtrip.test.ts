import { describe, expect, it } from 'vitest';
import { AxSignature, f } from './sig.js';

const jsonNorm = (value: unknown) => JSON.parse(JSON.stringify(value));

// Normalize representation differences that carry no meaning: the string
// parser stores explicit booleans where the fluent path stores undefined.
const normalizeFields = (fields: readonly unknown[]) =>
  (fields as any[]).map((field) =>
    jsonNorm({
      ...field,
      isOptional: !!field.isOptional,
      isInternal: !!field.isInternal,
      isCached: !!field.isCached,
      type: field.type
        ? { ...field.type, isArray: !!field.type.isArray }
        : undefined,
    })
  );

describe('signature string round-trip', () => {
  const corpus: [string, string][] = [
    ['plain fields', 'userQuestion:string -> modelAnswer:string'],
    [
      'markers, arrays, class and signature description',
      '"Top desc" userQuestion?:string "the q" -> modelAnswer!:number[], verdictLabel:class "pass, fail" "the verdict"',
    ],
    [
      'constraint bags',
      'userAge:number(min 0, max 120), contactEmail:string(format email, cache) -> userName:string(pattern "^[a-z_]+$" "lowercase name")',
    ],
    [
      'code language',
      'codeSnippet:code(python) -> fixedSnippet:code(typescript) "the fixed code"',
    ],
    [
      'item descriptions',
      'tagList:string(item "a short tag")[] "all tags" -> scoreList:number(min 0, max 10)[]',
    ],
    [
      'nested objects',
      'profileInfo:object{ fullName:string, userAge?:number(min 0) "years", nested:object{ deepValue:string }[] } -> summaryText:string(max 500)',
    ],
  ];

  for (const [label, signature] of corpus) {
    it(`parse -> toString -> parse is stable for ${label}`, () => {
      const first = AxSignature.create(signature);
      const rendered = first.toString();
      const second = AxSignature.create(rendered);

      expect(jsonNorm(second.getInputFields())).toEqual(
        jsonNorm(first.getInputFields())
      );
      expect(jsonNorm(second.getOutputFields())).toEqual(
        jsonNorm(first.getOutputFields())
      );
      expect(second.getDescription()).toBe(first.getDescription());
      // Rendering reaches a fixed point: a canonical string renders to itself.
      expect(second.toString()).toBe(rendered);
    });
  }

  it('fluent signatures survive toString() -> parse with all extended features', () => {
    const fluentSig = f()
      .input('contextText', f.string('shared context').cache())
      .input('userAge', f.number().min(0).max(120).optional())
      .input('codeSnippet', f.code('python'))
      .input('tagList', f.string('a short tag').array('all tags'))
      .output(
        'profileList',
        f
          .object({
            fullName: f.string('the name'),
            contactEmail: f.string().email(),
            priority: f.class(['high', 'low']),
            nested: f.object({ deepValue: f.string() }).array(),
          })
          .array('profiles')
      )
      .output('userName', f.string().regex('^[a-z_]+$', 'lowercase'))
      .output('innerThought', f.string().internal())
      .build();

    const rendered = fluentSig.toString();
    const parsedAgain = AxSignature.create(rendered);

    expect(normalizeFields(parsedAgain.getInputFields())).toEqual(
      normalizeFields(fluentSig.getInputFields())
    );
    expect(normalizeFields(parsedAgain.getOutputFields())).toEqual(
      normalizeFields(fluentSig.getOutputFields())
    );
  });

  it('renders legacy signatures byte-identically to the historical form', () => {
    const cases: [string, string][] = [
      [
        'userQuestion:string -> modelAnswer:string',
        'userQuestion:string -> modelAnswer:string',
      ],
      [
        '"Top desc"userQuestion?:string "the q"->modelAnswer!:number[],verdictLabel:class "pass, fail"',
        '"Top desc" userQuestion?:string "the q" -> modelAnswer!:number[], verdictLabel:class "pass | fail"',
      ],
      [
        'imageData:image "photo", audioClips:audio -> answerText:string',
        'imageData:image "photo", audioClips:audio -> answerText:string',
      ],
    ];
    for (const [input, expected] of cases) {
      expect(AxSignature.create(input).toString()).toBe(expected);
    }
  });

  it('escapes quotes and backslashes in rendered descriptions', () => {
    const sig = f()
      .input('userQuestion', f.string('say "hi" with a \\ backslash'))
      .output('replyText', f.string())
      .build();
    const rendered = sig.toString();
    const parsedAgain = AxSignature.create(rendered);
    expect(parsedAgain.getInputFields()[0]?.description).toBe(
      'say "hi" with a \\ backslash'
    );
  });
});
