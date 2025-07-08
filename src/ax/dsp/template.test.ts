import { describe, expect, it } from 'vitest';

import { AxGen } from './generate.js';
import { AxSignature } from './sig.js';
import { ax, f, s } from './template.js';

describe('AxSignature Tagged Templates', () => {
  it('should create basic signature from template', () => {
    const sig = s`userQuestion:string -> modelAnswer:string`;

    expect(sig.getInputFields()).toHaveLength(1);
    expect(sig.getOutputFields()).toHaveLength(1);
    expect(sig.getInputFields()[0]?.name).toBe('userQuestion');
    expect(sig.getOutputFields()[0]?.name).toBe('modelAnswer');
  });

  it('should handle simple string interpolation', () => {
    const inputType = 'string';
    const outputType = 'number';
    const sig = s`inputValue:${inputType} -> outputValue:${outputType}`;

    expect(sig.getInputFields()[0]?.type?.name).toBe('string');
    expect(sig.getOutputFields()[0]?.type?.name).toBe('number');
  });

  it('should handle field type interpolation', () => {
    const inputType = f.string('User question');
    const outputType = f.class(
      ['positive', 'negative'],
      'Sentiment classification'
    );

    const sig = s`userQuestion:${inputType} -> sentimentValue:${outputType}`;

    const inputField = sig.getInputFields()[0];
    const outputField = sig.getOutputFields()[0];

    expect(inputField?.name).toBe('userQuestion');
    expect(inputField?.type?.name).toBe('string');
    expect(inputField?.description).toBe('User question');

    expect(outputField?.name).toBe('sentimentValue');
    expect(outputField?.type?.name).toBe('class');
    expect(outputField?.type?.options).toEqual(['positive', 'negative']);
  });

  it('should handle description interpolation', () => {
    const description = 'Analyze customer feedback';
    const sig = s`"${description}" feedback:string -> sentiment:string`;

    expect(sig.getDescription()).toBe(description);
  });

  it('should handle complex multi-field signatures', () => {
    const sig = s`
      emailText:${f.string('Input text')} -> 
      categoryType:${f.class(['tech', 'business', 'sports'])},
      confidenceScore:${f.number('Confidence score 0-1')},
      tagList:${f.array(f.string())}
    `;

    expect(sig.getInputFields()).toHaveLength(1);
    expect(sig.getOutputFields()).toHaveLength(3);

    const categoryField = sig.getOutputFields()[0];
    const confidenceField = sig.getOutputFields()[1];
    const tagsField = sig.getOutputFields()[2];

    expect(categoryField?.name).toBe('categoryType');
    expect(categoryField?.type?.name).toBe('class');
    expect(categoryField?.type?.options).toEqual([
      'tech',
      'business',
      'sports',
    ]);

    expect(confidenceField?.name).toBe('confidenceScore');
    expect(confidenceField?.type?.name).toBe('number');
    expect(confidenceField?.description).toBe('Confidence score 0-1');

    expect(tagsField?.name).toBe('tagList');
    expect(tagsField?.type?.name).toBe('string');
    expect(tagsField?.type?.isArray).toBe(true);
  });

  it('should handle optional and internal fields', () => {
    const sig = s`
      userInput:string -> 
      outValue:${f.optional(f.string())},
      reasoningText:${f.internal(f.string('Internal reasoning'))}
    `;

    const outputField = sig.getOutputFields()[0];
    const reasoningField = sig.getOutputFields()[1];

    expect(outputField?.isOptional).toBe(true);
    expect(reasoningField?.isInternal).toBe(true);
    expect(reasoningField?.description).toBe('Internal reasoning');
  });

  it('should handle code fields', () => {
    const sig = s`
      problemDesc:string -> 
      solutionCode:${f.code('python', 'Python code solution')}
    `;

    const solutionField = sig.getOutputFields()[0];
    expect(solutionField?.type?.name).toBe('code');
    expect(solutionField?.type?.options).toBeUndefined();
    expect(solutionField?.description).toBe('Python code solution');
  });

  it('should handle date and datetime fields', () => {
    const sig = s`
      eventDesc:string -> 
      startDate:${f.date('Event start date')},
      creationTime:${f.datetime('Creation timestamp')}
    `;

    const startDateField = sig.getOutputFields()[0];
    const createdAtField = sig.getOutputFields()[1];

    expect(startDateField?.type?.name).toBe('date');
    expect(startDateField?.description).toBe('Event start date');

    expect(createdAtField?.type?.name).toBe('datetime');
    expect(createdAtField?.description).toBe('Creation timestamp');
  });

  it('should handle json and boolean fields', () => {
    const sig = s`
      jsonData:${f.json('Input JSON data')} -> 
      isValidFlag:${f.boolean('Validation result')},
      metaInfo:${f.json()}
    `;

    const inputField = sig.getInputFields()[0];
    const isValidField = sig.getOutputFields()[0];
    const metadataField = sig.getOutputFields()[1];

    expect(inputField?.type?.name).toBe('json');
    expect(inputField?.description).toBe('Input JSON data');

    expect(isValidField?.type?.name).toBe('boolean');
    expect(isValidField?.description).toBe('Validation result');

    expect(metadataField?.type?.name).toBe('json');
  });

  it('should handle array fields of different types', () => {
    const sig = s`
      inputText:string -> 
      tagList:${f.array(f.string())},
      scoreList:${f.array(f.number())},
      flagList:${f.array(f.boolean())},
      categoryList:${f.array(f.class(['a', 'b', 'c']))}
    `;

    const fields = sig.getOutputFields();

    expect(fields[0]?.type?.name).toBe('string');
    expect(fields[0]?.type?.isArray).toBe(true);

    expect(fields[1]?.type?.name).toBe('number');
    expect(fields[1]?.type?.isArray).toBe(true);

    expect(fields[2]?.type?.name).toBe('boolean');
    expect(fields[2]?.type?.isArray).toBe(true);

    expect(fields[3]?.type?.name).toBe('class');
    expect(fields[3]?.type?.isArray).toBe(true);
    expect(fields[3]?.type?.options).toEqual(['a', 'b', 'c']);
  });

  it('should handle combined modifiers', () => {
    const sig = s`
      inputText:string -> 
      optionalList:${f.optional(f.array(f.string()))},
      internalCategory:${f.internal(f.class(['x', 'y']))},
      complexScores:${f.optional(f.internal(f.array(f.number('Scores'))))}
    `;

    const fields = sig.getOutputFields();

    expect(fields[0]?.isOptional).toBe(true);
    expect(fields[0]?.type?.isArray).toBe(true);
    expect(fields[0]?.type?.name).toBe('string');

    expect(fields[1]?.isInternal).toBe(true);
    expect(fields[1]?.type?.name).toBe('class');
    expect(fields[1]?.type?.options).toEqual(['x', 'y']);

    expect(fields[2]?.isOptional).toBe(true);
    expect(fields[2]?.isInternal).toBe(true);
    expect(fields[2]?.type?.isArray).toBe(true);
    expect(fields[2]?.type?.name).toBe('number');
    expect(fields[2]?.description).toBe('Scores');
  });

  it('should be equivalent to string-based signatures', () => {
    const stringSig = new AxSignature(
      'userQuestion:string -> modelAnswer:string, confidenceValue:number'
    );
    const templateSig = s`userQuestion:string -> modelAnswer:string, confidenceValue:number`;

    expect(templateSig.getInputFields()).toHaveLength(
      stringSig.getInputFields().length
    );
    expect(templateSig.getOutputFields()).toHaveLength(
      stringSig.getOutputFields().length
    );

    expect(templateSig.getInputFields()[0]?.name).toBe(
      stringSig.getInputFields()[0]?.name
    );
    expect(templateSig.getOutputFields()[0]?.name).toBe(
      stringSig.getOutputFields()[0]?.name
    );
    expect(templateSig.getOutputFields()[1]?.name).toBe(
      stringSig.getOutputFields()[1]?.name
    );
  });
});

describe('Field Builders', () => {
  it('should create string fields', () => {
    const field1 = f.string();
    const field2 = f.string('Description');

    expect(field1.type).toBe('string');
    expect(field1.description).toBeUndefined();

    expect(field2.type).toBe('string');
    expect(field2.description).toBe('Description');
  });

  it('should create class fields', () => {
    const classField = f.class(['option1', 'option2'], 'Classification');

    expect(classField.type).toBe('class');
    expect(classField.options).toEqual(['option1', 'option2']);
    expect(classField.description).toBe('Classification');
  });

  it('should create code fields', () => {
    const codeField = f.code('javascript', 'JS code');

    expect(codeField.type).toBe('code');
    expect(codeField.options).toEqual(['javascript']);
    expect(codeField.description).toBe('JS code');
  });

  it('should create array fields', () => {
    const arrayField = f.array(f.string('Item'));

    expect(arrayField.type).toBe('string');
    expect(arrayField.isArray).toBe(true);
    expect(arrayField.description).toBe('Item');
  });

  it('should create optional fields', () => {
    const optionalField = f.optional(f.number('Score'));

    expect(optionalField.type).toBe('number');
    expect(optionalField.isOptional).toBe(true);
    expect(optionalField.description).toBe('Score');
  });

  it('should create internal fields', () => {
    const internalField = f.internal(f.string('Reasoning'));

    expect(internalField.type).toBe('string');
    expect(internalField.isInternal).toBe(true);
    expect(internalField.description).toBe('Reasoning');
  });

  it('should chain modifiers', () => {
    const complexField = f.optional(f.internal(f.array(f.class(['a', 'b']))));

    expect(complexField.type).toBe('class');
    expect(complexField.isArray).toBe(true);
    expect(complexField.isOptional).toBe(true);
    expect(complexField.isInternal).toBe(true);
    expect(complexField.options).toEqual(['a', 'b']);
  });
});

describe('AxGen Tagged Templates', () => {
  it('should create AxGen instance from template', () => {
    const gen = ax`
      "A simple summarizer"
      textToSummarize:string -> summary:string
    `;
    expect(gen).toBeInstanceOf(AxGen);
    const sig = new AxSignature(gen.getSignature());

    expect(sig.getDescription()).toBe('A simple summarizer');
    expect(sig.getInputFields()[0]?.name).toBe('textToSummarize');
    expect(sig.getOutputFields()[0]?.name).toBe('summary');
  });

  it('should handle field type interpolation with AxGen', () => {
    const gen = ax`
      userQuestion:${f.string('User question')} -> 
      sentiment:${f.class(['positive', 'negative'])}
    `;
    const sig = new AxSignature(gen.getSignature());

    const inputField = sig.getInputFields()[0];
    const outputField = sig.getOutputFields()[0];

    expect(inputField?.description).toBe('User question');
    expect(outputField?.type?.name).toBe('class');
  });

  it('should handle complex multi-field signatures with AxGen', () => {
    const gen = ax`
      emailText:${f.string('Email content')} -> 
      categoryType:${f.class(['urgent', 'normal'])},
      actionItems:${f.array(f.string())}
    `;
    const sig = new AxSignature(gen.getSignature());

    expect(sig.getOutputFields()).toHaveLength(2);
    expect(sig.getOutputFields()[0]?.name).toBe('categoryType');
    expect(sig.getOutputFields()[1]?.name).toBe('actionItems');
    expect(sig.getOutputFields()[1]?.type?.isArray).toBe(true);
  });

  it('should handle optional and internal fields with AxGen', () => {
    const gen = ax`
      userInput:string -> 
      primaryResponse:${f.string()},
      secondaryResponse:${f.optional(f.string())},
      debuggingInfo:${f.internal(f.json())}
    `;
    const sig = new AxSignature(gen.getSignature());
    const secondaryField = sig.getOutputFields()[1];
    const debugField = sig.getOutputFields()[2];

    expect(secondaryField?.isOptional).toBe(true);
    expect(debugField?.isInternal).toBe(true);
  });

  it('should be equivalent to AxGen constructor with string signature', () => {
    const stringGen = new AxGen('userQuestion:string -> modelAnswer:string');
    const templateGen = ax`userQuestion:string -> modelAnswer:string`;

    const stringSig = new AxSignature(stringGen.getSignature());
    const templateSig = new AxSignature(templateGen.getSignature());

    expect(templateSig.toString()).toBe(stringSig.toString());
  });
});
