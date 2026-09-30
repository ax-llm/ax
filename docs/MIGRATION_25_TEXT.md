# Text answers in Ax 25

Text-contract generation now always follows TypeScript extraction. A reply such as `{"answer":"Paris"}` to a single string output is that literal string, rather than the value `Paris`. For labeled text, return `Answer: Paris`. A bare object no longer fills several declared outputs; missing fields trigger the normal validation and correction path.

Use the structured-output modes when the model should return an object. An optional text field answered as `null` is omitted from the result, as in TypeScript.
