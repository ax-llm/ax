---
title:  What's a prompt signature?
description: Prompt signatures are how you define the inputs and outputs to a Ax Prompt.
---

<img width="860" alt="shapes at 24-03-31 00 05 55" src="https://github.com/dosco/llm-client/assets/832235/0f0306ea-1812-4a0a-9ed5-76cd908cd26b">

Efficient type-safe prompts are auto-generated from a simple signature. A prompt signature is made up of a `"task description" inputField:type "field description" -> "outputField:type`. The idea behind prompt signatures is based on work done in the "Demonstrate-Search-Predict" paper.

You can have multiple input and output fields, and each field can be of the types `string`, `number`, `boolean`, `date`, `datetime`, `class "class1, class2"`, `JSON`, or an array of any of these, e.g., `string[]`. When a type is not defined, it defaults to `string`. The underlying AI is encouraged to generate the correct JSON when the `JSON` type is used.

## Output Field Types

| Type                      | Description                       | Usage                      | Example Output                                     |
|---------------------------|-----------------------------------|----------------------------|----------------------------------------------------|
| `string`                  | A sequence of characters.         | `fullName:string`          | `"example"`                                        |
| `number`                  | A numerical value.                | `price:number`             | `42`                                               |
| `boolean`                 | A true or false value.            | `isEvent:boolean`          | `true`, `false`                                    |
| `date`                    | A date value.                     | `startDate:date`           | `"2023-10-01"`                                     |
| `datetime`                | A date and time value.            | `createdAt:datetime`       | `"2023-10-01T12:00:00Z"`                           |
| `class "class1,class2"`   | A classification of items.        | `category:class`           | `["class1", "class2", "class3"]`                   |
| `string[]`                | An array of strings.              | `tags:string[]`            | `["example1", "example2"]`                         |
| `number[]`                | An array of numbers.              | `scores:number[]`          | `[1, 2, 3]`                                        |
| `boolean[]`               | An array of boolean values.       | `permissions:boolean[]`    | `[true, false, true]`                              |
| `date[]`                  | An array of dates.                | `holidayDates:date[]`      | `["2023-10-01", "2023-10-02"]`                     |
| `datetime[]`              | An array of date and time values. | `logTimestamps:datetime[]` | `["2023-10-01T12:00:00Z", "2023-10-02T12:00:00Z"]` |
| `class[] "class1,class2"` | Multiple classes                  | `categories:class[]`       | `["class1", "class2", "class3"]`                   |


