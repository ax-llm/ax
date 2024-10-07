import test from 'ava';

import { parseLLMFriendlyDate, parseLLMFriendlyDateTime } from './datetime.js';

test('datetime parsing', (t) => {
  const dt = parseLLMFriendlyDateTime('2022-01-01 12:00:00 EST');
  t.is(dt.toUTCString(), 'Sat, 01 Jan 2022 17:00:00 GMT');
});

test('datetime parsing: invalid datetime value', (t) => {
  t.throws(() => parseLLMFriendlyDateTime('2022-01-01 12:00:00'));
});

test('date parsing', (t) => {
  const dt = parseLLMFriendlyDate('2022-01-01');
  t.is(dt.toUTCString(), 'Sat, 01 Jan 2022 00:00:00 GMT');
});

test('date parsing: invalid date value', (t) => {
  t.throws(() => parseLLMFriendlyDate('2022-01-32'));
});
