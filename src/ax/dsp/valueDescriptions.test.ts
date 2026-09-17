import { describe, expect, it } from 'vitest';
import { parseSignature } from './parser.js';
import { AxPromptTemplate } from './prompt.js';
import { AxSignature, f, fn } from './sig.js';

const booleanSignature = `ticket:string -> urgent:boolean(
  true "Customers cannot complete a core task",
  false "A routine request or minor inconvenience"
) "Does this need immediate attention?"`;
const descriptions = {
  true: 'Customers cannot complete a core task',
  false: 'A routine request or minor inconvenience',
};
const combined =
  'Does this need immediate attention?\ntrue: Customers cannot complete a core task\nfalse: A routine request or minor inconvenience';

describe('signature value descriptions', () => {
  it('preserves structure and renders readable guidance in prompts and schemas', () => {
    const sig = AxSignature.from(booleanSignature);
    const original = structuredClone(sig.toJSON());
    expect(sig.getOutputFields()[0]).toMatchObject({
      description: 'Does this need immediate attention?',
      type: { name: 'boolean', valueDescriptions: descriptions },
    });
    expect(sig.toJSONSchema().properties?.urgent).toEqual({
      type: 'boolean',
      description: combined,
    });
    const prompt = new AxPromptTemplate(sig);
    for (let i = 0; i < 2; i++) {
      expect(
        prompt.render({ ticket: 'Checkout is broken' }, {})[0]
      ).toMatchObject({ content: expect.stringContaining(combined) });
      expect(sig.toJSONSchema().properties?.urgent.description).toBe(combined);
    }
    expect(sig.toJSON()).toEqual(original);
  });

  it('round-trips boolean and class guidance, quotes, commas, and parentheses', () => {
    const sig = AxSignature.from(
      `ticket:string -> urgent:boolean(true "A task (checkout) is blocked, or unavailable", false "Routine request"), team:class "support, urgent billing"(support "Usage help", "urgent billing" "An invoice says \\"overdue\\" (past due)") "Which team?"`
    );
    const restored = AxSignature.from(sig.toString());
    expect(restored.toJSON()).toEqual(sig.toJSON());
    expect(AxSignature.from(sig).toJSON()).toEqual(sig.toJSON());
    expect(restored.toJSONSchema().properties?.team.description).toBe(
      'Which team?\nsupport: Usage help\nurgent billing: An invoice says "overdue" (past due)'
    );
  });

  it('keeps fluent and string forms equivalent, with immutable fluent modifiers', () => {
    const original = f.boolean('Does this need immediate attention?');
    const field = original.describeValues(descriptions);
    const fluent = f()
      .input('ticket', f.string())
      .output('urgent', field)
      .build();
    expect(original.valueDescriptions).toBeUndefined();
    expect(fluent.toString()).toBe(
      AxSignature.from(booleanSignature).toString()
    );
    expect(fluent.toJSONSchema()).toEqual(
      AxSignature.from(booleanSignature).toJSONSchema()
    );
    const changed = f()
      .input('ticket', f.string())
      .output(
        'urgent',
        original.describeValues({ true: 'Different criterion' })
      )
      .build();
    expect(changed.hash()).not.toBe(fluent.hash());
    expect(
      AxSignature.from(fluent.toString()).getOutputFields()[0]?.type
        ?.valueDescriptions
    ).toEqual(descriptions);
  });

  it('preserves partial class descriptions in declared order and through arrays and optional fields', () => {
    const field = f
      .class(['support', 'billing', 'engineering'], 'Which team?')
      .describeValues({
        engineering: 'Broken functionality',
        support: 'Usage help',
      })
      .optional()
      .array('Matching teams');
    const sig = f().input('ticket', f.string()).output('teams', field).build();
    expect(AxSignature.from(sig.toString()).toJSONSchema()).toEqual(
      sig.toJSONSchema()
    );
    expect(sig.toJSONSchema().properties?.teams.items).toMatchObject({
      enum: ['support', 'billing', 'engineering'],
      description:
        'Matching teams\nsupport: Usage help\nengineering: Broken functionality',
    });
  });

  it('retains nested and input guidance in both prompt and schema rendering', () => {
    const sig = AxSignature.from(
      'enabled:boolean(true "Feature is on", false "Feature is off") -> profile:object{ urgent:boolean(true "Core task blocked", false "Routine request"), team:class "support, billing"(billing "Invoice question") }'
    );
    const rendered = JSON.stringify(
      new AxPromptTemplate(sig).render({ enabled: true }, {})
    );
    expect(rendered).toContain('true: Feature is on');
    expect(rendered).toContain('profile.urgent = true: Core task blocked');
    expect(rendered).toContain('profile.team = billing: Invoice question');
    expect(
      sig.toJSONSchema().properties?.profile.properties?.urgent.description
    ).toContain('true: Core task blocked');
    expect(
      sig.toJSONSchema().properties?.profile.properties?.team.description
    ).toContain('billing: Invoice question');
    expect(AxSignature.from(sig.toString()).toJSONSchema()).toEqual(
      sig.toJSONSchema()
    );
  });

  it('includes value guidance in ordinary tool schemas', () => {
    const tool = fn('triageTicket')
      .description('Triage a ticket')
      .arg('urgent', f.boolean('Urgent?').describeValues(descriptions))
      .handler(async ({ urgent }) => String(urgent))
      .build();
    expect(tool.parameters?.properties?.urgent.description).toContain(
      'true: Customers cannot complete a core task'
    );
  });

  it.each([
    'urgent:boolean(true "Yes", true "Again")',
    'urgent:boolean(true "")',
    'urgent:boolean(true)',
    'urgent:boolean(maybe "Maybe")',
    'urgent:string(true "Yes")',
    'team:class "support, billing"(unknown "Other")',
    'team:class "support, billing"(support "One", "support" "Two")',
    'team:class "support, billing"(support "")',
    'team:class "support, billing"()',
    'team:class "support, billing"(support "One",)',
  ])('rejects malformed or incompatible annotations: %s', (output) => {
    expect(() => parseSignature(`ticket:string -> ${output}`)).toThrow();
  });

  it('validates fluent and programmatic descriptions, including nested fields', () => {
    expect(() => f.boolean().describeValues({ true: '' })).toThrow('nonempty');
    expect(() =>
      AxSignature.from({
        inputs: [{ name: 'ticket' }],
        outputs: [
          {
            name: 'urgent',
            type: { name: 'boolean', valueDescriptions: { maybe: 'Unknown' } },
          },
        ],
      })
    ).toThrow('unknown described value');
    expect(() =>
      f()
        .input('ticket', f.string())
        .output(
          'profile',
          f.object({
            amount: { type: 'number', valueDescriptions: { true: 'Invalid' } },
          })
        )
        .build()
    ).toThrow('boolean or class');
  });
});
