import test from 'ava';

import { extractValues, Signature } from './sig.js';

test('extractValues', (t) => {
  const sig = new Signature(`question -> answer`);
  const v1 = extractValues(sig, `Answer: "hello world"`);

  t.deepEqual(v1, { answer: '"hello world"' });
});

test('extractValues with no prefix and single output', (t) => {
  const sig = new Signature(`question -> answer`);
  const v1 = extractValues(sig, `"hello world"`);

  t.deepEqual(v1, { answer: '"hello world"' });
});

test('extractValues with json', (t) => {
  const sig = new Signature(`question -> answer : json`);
  const v1 = extractValues(sig, 'Answer: ```json\n{"hello": "world"}\n```');

  t.deepEqual(v1, { answer: { hello: 'world' } });
});

test('extractValues with text values', (t) => {
  const sig = new Signature(`text -> title, keyPoints, description`);
  const v1 = extractValues(
    sig,
    `
    Title: Coastal Ecosystem Restoration

    Key Points: Coastal regions prone to natural disasters, Selection criteria based on vulnerability indices and population density, Climate risk assessments conducted for sea-level rise and extreme weather events, Targeted ecosystems include mangrove forests, coral reefs, wetlands

    Description: The project focuses on coastal regions vulnerable to natural disasters like hurricanes and flooding. Selection criteria included vulnerability indices, population density, and proximity to critical infrastructure. Climate risk assessments identified risks related to sea-level rise, storm surges, and extreme weather events. Targeted ecosystems encompass mangrove forests, coral reefs, and wetlands that provide coastal protection, biodiversity support, and livelihood opportunities for local communities.
    `
  );

  t.deepEqual(v1, {
    title: 'Coastal Ecosystem Restoration',
    keyPoints:
      'Coastal regions prone to natural disasters, Selection criteria based on vulnerability indices and population density, Climate risk assessments conducted for sea-level rise and extreme weather events, Targeted ecosystems include mangrove forests, coral reefs, wetlands',
    description:
      'The project focuses on coastal regions vulnerable to natural disasters like hurricanes and flooding. Selection criteria included vulnerability indices, population density, and proximity to critical infrastructure. Climate risk assessments identified risks related to sea-level rise, storm surges, and extreme weather events. Targeted ecosystems encompass mangrove forests, coral reefs, and wetlands that provide coastal protection, biodiversity support, and livelihood opportunities for local communities.'
  });
});
