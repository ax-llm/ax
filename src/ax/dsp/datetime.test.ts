import test from 'ava';

import { parseLLMFriendlyDate, parseLLMFriendlyDateTime } from './datetime.js';
import type { AxField } from './sig.js';

const field: AxField = {
  name: 'date',
  type: { name: 'date', isArray: false }
};

test('datetime parsing with timezone abbr', (t) => {
  const dt = parseLLMFriendlyDateTime(field, '2022-01-01 12:00 EST');
  t.is(dt.toUTCString(), 'Sat, 01 Jan 2022 17:00:00 GMT');
});

test('datetime parsing with seconds and timezone abbr', (t) => {
  const dt = parseLLMFriendlyDateTime(field, '2022-01-01 12:00:10 EST');
  t.is(dt.toUTCString(), 'Sat, 01 Jan 2022 17:00:10 GMT');
});

test('datetime parsing with full timezone', (t) => {
  const dt = parseLLMFriendlyDateTime(
    field,
    '2022-01-01 12:00 America/New_York'
  );
  t.is(dt.toUTCString(), 'Sat, 01 Jan 2022 17:00:00 GMT');
});

test('datetime parsing: invalid datetime value', (t) => {
  t.throws(() => parseLLMFriendlyDateTime(field, '2022-01-01 12:00'));
});

test('date parsing', (t) => {
  const dt = parseLLMFriendlyDate(field, '2022-01-01');
  t.is(dt.toUTCString(), 'Sat, 01 Jan 2022 00:00:00 GMT');
});

test('date parsing: invalid date value', (t) => {
  t.throws(() => parseLLMFriendlyDate(field, '2022-01-32'));
});
