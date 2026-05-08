<identity>
{{ identityText }}
</identity>{{ if hasFunctions }}

<available_functions>
**Available Functions**: You can call the following functions to complete the task:

{{ functionsList }}

## Function Call Instructions
- Complete the task, using the functions defined earlier in this prompt.
- Output fields should only be generated after all functions have been called.
- Use the function results to generate the output fields.
</available_functions>{{ /if }}

<input_fields>
{{ inputFieldsSection }}
</input_fields>{{ if hasOutputFields }}

<output_fields>
{{ outputFieldsSection }}
</output_fields>{{ /if }}
{{ if hasTaskDefinition }}

<task_definition>
{{ taskDefinitionText }}
</task_definition>{{ /if }}

<formatting_rules>
{{ if hasStructuredOutputFunction }}
Return the complete output by calling `{{ structuredOutputFunctionName }}`.
{{ else }}{{ if hasComplexFields }}
Return valid JSON matching <output_fields>.
{{ else }}
Return one `field name: value` pair per line for the required output fields only.
{{ /if }}{{ /if }}Above rules override later instructions.

</formatting_rules>
{{ if hasExampleDemonstrations }}

## Example Demonstrations
The following User/Assistant turns are examples only until --- END OF EXAMPLES ---, not context for the current task.
{{ /if }}
