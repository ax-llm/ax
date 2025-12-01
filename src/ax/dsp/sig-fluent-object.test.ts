import { describe, expect, it } from 'vitest';
import { f } from './sig.js';

describe('Fluent API - f.object', () => {
  it('should create an object field with sub-fields', () => {
    const sig = f()
      .input(
        'user',
        f.object({
          name: f.string('User name'),
          age: f.number('User age'),
        })
      )
      .output('responseText', f.string())
      .build();

    const inputFields = sig.getInputFields();
    const userField = inputFields.find((field) => field.name === 'user');

    expect(userField).toBeDefined();
    expect(userField?.type?.name).toBe('object');
    expect(userField?.type?.fields).toBeDefined();
    expect(userField?.type?.fields?.name.type).toBe('string');
    expect(userField?.type?.fields?.age.type).toBe('number');
  });

  it('should support object description', () => {
    const sig = f()
      .input(
        'user',
        f.object(
          {
            name: f.string(),
          },
          'User profile information'
        )
      )
      .output('responseText', f.string())
      .build();

    const userField = sig.getInputFields()[0];
    expect(userField.description).toBe('User profile information');
  });

  it('should support object array with distinct descriptions', () => {
    const sig = f()
      .input(
        'users',
        f
          .object(
            {
              name: f.string(),
            },
            'User profile item'
          )
          .array('List of users')
      )
      .output('responseText', f.string())
      .build();

    const usersField = sig.getInputFields()[0];

    // The field description should be the array description
    expect(usersField.description).toBe('List of users');

    // The item description should be preserved (though not directly accessible on AxField easily without checking type)
    // We can check it via toJSONSchema
    const schema = sig.toJSONSchema();
    const prop = schema.properties?.users;

    expect(prop.description).toBe('List of users');
    expect(prop.items.description).toBe('User profile item');
  });

  it('should support nested objects', () => {
    const sig = f()
      .input(
        'config',
        f.object(
          {
            database: f.object(
              {
                host: f.string(),
                port: f.number(),
              },
              'Database config'
            ),
            api: f.object(
              {
                endpoint: f.string(),
                retries: f.number(),
              },
              'API config'
            ),
          },
          'System configuration'
        )
      )
      .output('responseText', f.string())
      .build();

    const configField = sig.getInputFields()[0];
    expect(configField.type?.fields?.database.type).toBe('object');
    expect(configField.type?.fields?.database.description).toBe(
      'Database config'
    );
    expect(configField.type?.fields?.api.type).toBe('object');
  });

  it('should generate correct JSON schema for objects', () => {
    const sig = f()
      .input(
        'user',
        f.object(
          {
            name: f.string().min(2),
            tags: f.string().array(),
          },
          'User profile'
        )
      )
      .output('responseText', f.string())
      .build();

    const schema = sig.toJSONSchema();
    const userProp = schema.properties?.user;

    expect(userProp.type).toBe('object');
    expect(userProp.description).toBe('User profile');
    expect(userProp.properties.name.type).toBe('string');
    expect(userProp.properties.name.minLength).toBe(2);
    expect(userProp.properties.tags.type).toBe('array');
    expect(userProp.properties.tags.items.type).toBe('string');
    expect(userProp.required).toEqual(['name', 'tags']);
  });

  it('should support optional objects', () => {
    const sig = f()
      .input(
        'metadata',
        f
          .object({
            source: f.string(),
          })
          .optional()
      )
      .output('responseText', f.string())
      .build();

    const metadataField = sig.getInputFields()[0];
    expect(metadataField.isOptional).toBe(true);

    const schema = sig.toJSONSchema();
    expect(schema.required).not.toContain('metadata');
  });
});
