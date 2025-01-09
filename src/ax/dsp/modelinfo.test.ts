import test from 'ava';

import { axGetModelInfo } from './modelinfo.js';

const modelMap = {
  'claude-3': 'claude-3-5-sonnet'
};

const modelInfo = [
  {
    name: 'claude-3-5-sonnet',
    currency: 'usd',
    promptTokenCostPer1M: 15000,
    completionTokenCostPer1M: 75000
  },
  {
    name: 'gpt-4o-mini',
    currency: 'usd',
    promptTokenCostPer1M: 10000,
    completionTokenCostPer1M: 30000
  }
];

test('exact match should return correct model info', (t) => {
  const result = axGetModelInfo({ model: 'claude-3-5-sonnet', modelInfo });
  t.is(result.name, 'claude-3-5-sonnet');
  t.is(result.promptTokenCostPer1M, 15000);
});

test('should handle model mapping', (t) => {
  const result = axGetModelInfo({ model: 'claude-3', modelInfo, modelMap });
  t.is(result.name, 'claude-3-5-sonnet');
  t.is(result.promptTokenCostPer1M, 15000);
});

test('should handle vendor prefixes', (t) => {
  const result = axGetModelInfo({
    model: 'anthropic.claude-3-5-sonnet',
    modelInfo
  });
  t.is(result.name, 'claude-3-5-sonnet');
  t.is(result.promptTokenCostPer1M, 15000);
});

test('should handle date postfix', (t) => {
  const result = axGetModelInfo({
    model: 'claude-3-5-sonnet-20241022',
    modelInfo
  });
  t.is(result.name, 'claude-3-5-sonnet');
});

test('should handle version postfix', (t) => {
  const result = axGetModelInfo({ model: 'claude-3-5-sonnet-v2:0', modelInfo });
  t.is(result.name, 'claude-3-5-sonnet');
});

test('should handle alternative date format', (t) => {
  const result = axGetModelInfo({
    model: 'claude-3-5-sonnet@20241022',
    modelInfo
  });
  t.is(result.name, 'claude-3-5-sonnet');
});

test('should handle latest postfix', (t) => {
  const result = axGetModelInfo({
    model: 'claude-3-5-sonnet-latest',
    modelInfo
  });
  t.is(result.name, 'claude-3-5-sonnet');
});

test('should handle numeric id postfix', (t) => {
  const result = axGetModelInfo({ model: 'gpt-4o-mini-8388383', modelInfo });
  t.is(result.name, 'gpt-4o-mini');
});

test('should handle unknown model', (t) => {
  const result = axGetModelInfo({ model: 'unknown-model', modelInfo });
  t.is(result.name, 'unknown-model');
  t.is(result.promptTokenCostPer1M, 0);
  t.is(result.completionTokenCostPer1M, 0);
  t.is(result.currency, 'usd');
});

test('should handle complex version with date', (t) => {
  const result = axGetModelInfo({
    model: 'claude-3-5-sonnet-v2@20241022',
    modelInfo
  });
  t.is(result.name, 'claude-3-5-sonnet');
});

test('should handle vendor prefix with version', (t) => {
  const result = axGetModelInfo({
    model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    modelInfo
  });
  t.is(result.name, 'claude-3-5-sonnet');
});
