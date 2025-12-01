import { describe, expect, it } from 'vitest';
import { AxGen } from './generate.js';
import { AxSignature, f } from './sig.js';

describe('AxGen setExamples with complex signatures', () => {
  it('should validate examples with complex object signatures', () => {
    const sig = new AxSignature({
      inputs: [
        {
          name: 'queryInput',
          type: { name: 'string' },
        },
      ],
      outputs: [
        {
          name: 'userProfile',
          type: {
            name: 'object',
            fields: {
              nestedString: { type: 'string' },
              nestedNumber: { type: 'number' },
              nestedObject: {
                type: 'object',
                fields: {
                  deepString: { type: 'string' },
                },
              },
            },
          },
        },
      ],
    });

    const gen = new AxGen(sig);

    const examples = [
      {
        queryInput: 'test input',
        userProfile: {
          nestedString: 'hello',
          nestedNumber: 123,
          nestedObject: {
            deepString: 'deep',
          },
        },
      },
    ];

    // This should not throw
    expect(() => gen.setExamples(examples)).not.toThrow();
  });

  it('should validate examples with array of complex objects', () => {
    const sig = new AxSignature({
      inputs: [
        {
          name: 'queryInput',
          type: { name: 'string' },
        },
      ],
      outputs: [
        {
          name: 'itemList',
          type: {
            name: 'object',
            isArray: true,
            fields: {
              id: { type: 'number' },
              name: { type: 'string' },
            },
          },
        },
      ],
    });

    const gen = new AxGen(sig);

    const examples = [
      {
        queryInput: 'list input',
        itemList: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' },
        ],
      },
    ];

    // This should not throw
    expect(() => gen.setExamples(examples)).not.toThrow();
  });

  it('should validate examples with fluent API signature', () => {
    const sig = f()
      .input('searchQuery', f.string())
      .output(
        'searchResult',
        f.object({
          title: f.string(),
          meta: f.object({
            score: f.number(),
            tags: f.string().array(),
          }),
        })
      )
      .build();

    const gen = new AxGen(sig);

    const examples = [
      {
        searchQuery: 'search term',
        searchResult: {
          title: 'Result Title',
          meta: {
            score: 0.95,
            tags: ['tag1', 'tag2'],
          },
        },
      },
    ];

    // This should not throw
    expect(() => gen.setExamples(examples)).not.toThrow();
  });

  it('should validate examples with user provided complex scenario', () => {
    const signature = f()
      .input(
        'freeTimeRanges',
        f
          .json(
            'List of available free time ranges with human-readable datetime strings, ISO strings, and timezone. You can pick any part of a time range to select a time slot of the proper duration'
          )
          .array()
      )
      .input(
        'durationMinutes',
        f.number('Required meeting duration in minutes')
      )
      .input('subject', f.string('Meeting subject').optional())
      .input(
        'previousRejectionContext',
        f
          .string(
            "Natural language feedback from participants about what times don't work, WITH specific times"
          )
          .array()
          .optional()
      )
      .input(
        'participantCommunications',
        f
          .json(
            'List of participant communications with participantId, from (participant name, email), content (message body), and receivedAt'
          )
          .array()
          .optional()
      )
      .input(
        'userPreferences',
        f
          .string(
            "User's time preferences or scheduling constraints (e.g., 'tomorrow morning', 'Thursday afternoon', 'early next week', or general preferences like 'mornings preferred'). Use this to understand their timing preferences."
          )
          .optional()
      )
      .input(
        'userPreferenceTimeRange',
        f
          .json(
            "Structured datetime range representing the user's explicit time preference, parsed from natural language using englishToDatetimeRange. Contains precise start/end in the user's timezone."
          )
          .optional()
      )
      .output(
        'selectedSlots',
        f
          .object({
            startTimeISO: f.string(
              "Start time as a complete ISO-8601 Instant string (e.g. '2025-05-20T16:00:00Z'). MUST include date, time, and timezone offset (Z or +HH:MM)."
            ),
            endTimeISO: f.string(
              "End time as a complete ISO-8601 Instant string (e.g. '2025-05-20T17:00:00Z'). MUST include date, time, and timezone offset (Z or +HH:MM)."
            ),
            participantIds: f
              .string(
                'Participant ID that accepted this time slot (if matching)'
              )
              .array()
              .optional(),
          })
          .array()
      )
      .build();

    const gen = new AxGen(signature);

    const examples = [
      {
        freeTimeRanges: [
          {
            startTime: 'Monday, June 2, 2025 at 9:00 AM PDT',
            endTime: 'Monday, June 2, 2025 at 12:00 PM PDT',
            durationMinutes: 180,
            startTimeISO: '2025-06-02T16:00:00Z',
            endTimeISO: '2025-06-02T19:00:00Z',
          },
        ],
        durationMinutes: 60,
        subject: 'Team Sync',
        selectedSlots: [
          {
            startTimeISO: '2025-06-02T16:00:00Z',
            endTimeISO: '2025-06-02T17:00:00Z',
          },
          {
            startTimeISO: '2025-06-02T17:00:00Z',
            endTimeISO: '2025-06-02T18:00:00Z',
          },
        ],
      },
    ];

    expect(() => gen.setExamples(examples)).not.toThrow();
  });
});
