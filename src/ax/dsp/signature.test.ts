import { describe, expect, it } from 'vitest'

import { extractValues } from './extract.js'
import { AxSignature } from './sig.js'

describe('extractValues', () => {
  it('should extract simple answer value', () => {
    const sig = new AxSignature(`question -> answer`)
    const v1 = {}
    extractValues(sig, v1, `Answer: "hello world"`)

    expect(v1).toEqual({ answer: '"hello world"' })
  })

  it('should not extract value with no prefix and single output', () => {
    const sig = new AxSignature(`question -> answer`)
    const v1 = {}
    extractValues(sig, v1, `"hello world"`)

    expect(v1).toEqual({})
  })

  it('should extract and parse JSON values', () => {
    const sig = new AxSignature(`question -> answer : json`)

    const v1 = {}
    extractValues(sig, v1, 'Answer: ```json\n{"hello": "world"}\n```')

    expect(v1).toEqual({ answer: { hello: 'world' } })
  })

  it('should extract multiple text values', () => {
    const sig = new AxSignature(`someText -> title, keyPoints, description`)
    const v1 = {}
    extractValues(
      sig,
      v1,
      `
      Title: Coastal Ecosystem Restoration

      Key Points: Coastal regions prone to natural disasters, Selection criteria based on vulnerability indices and population density, Climate risk assessments conducted for sea-level rise and extreme weather events, Targeted ecosystems include mangrove forests, coral reefs, wetlands

      Description: The project focuses on coastal regions vulnerable to natural disasters like hurricanes and flooding. Selection criteria included vulnerability indices, population density, and proximity to critical infrastructure. Climate risk assessments identified risks related to sea-level rise, storm surges, and extreme weather events. Targeted ecosystems encompass mangrove forests, coral reefs, and wetlands that provide coastal protection, biodiversity support, and livelihood opportunities for local communities.
      `
    )

    expect(v1).toEqual({
      title: 'Coastal Ecosystem Restoration',
      keyPoints:
        'Coastal regions prone to natural disasters, Selection criteria based on vulnerability indices and population density, Climate risk assessments conducted for sea-level rise and extreme weather events, Targeted ecosystems include mangrove forests, coral reefs, wetlands',
      description:
        'The project focuses on coastal regions vulnerable to natural disasters like hurricanes and flooding. Selection criteria included vulnerability indices, population density, and proximity to critical infrastructure. Climate risk assessments identified risks related to sea-level rise, storm surges, and extreme weather events. Targeted ecosystems encompass mangrove forests, coral reefs, and wetlands that provide coastal protection, biodiversity support, and livelihood opportunities for local communities.',
    })
  })
})
