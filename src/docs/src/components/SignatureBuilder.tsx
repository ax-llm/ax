import { CopyIcon, PlayIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import type {
  FieldType,
  ModifierType,
  SignatureDefinition,
  SignatureField,
  SignatureTemplate,
} from '../types/signature';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Textarea } from './ui/textarea';

// Default signature templates
const SIGNATURE_TEMPLATES: SignatureTemplate[] = [
  {
    id: 'sentiment-analysis',
    name: 'Sentiment Analysis',
    description: 'Analyze text sentiment and extract confidence scores',
    category: 'Text Analysis',
    tags: ['sentiment', 'classification', 'analysis'],
    signature: {
      id: 'sentiment-sig',
      name: 'Sentiment Analysis',
      description: 'Analyze sentiment and confidence',
      inputFields: [
        {
          id: 'input-1',
          name: 'inputText',
          type: 'string',
          description: 'Text to analyze for sentiment',
          modifiers: [],
          isInput: true,
        },
      ],
      outputFields: [
        {
          id: 'output-1',
          name: 'sentimentCategory',
          type: 'class',
          description: 'Sentiment classification',
          modifiers: [],
          isInput: false,
          classOptions: ['positive', 'negative', 'neutral'],
        },
        {
          id: 'output-2',
          name: 'confidenceScore',
          type: 'number',
          description: 'Confidence score 0-1',
          modifiers: [],
          isInput: false,
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  },
  {
    id: 'code-generation',
    name: 'Code Generation',
    description: 'Generate code solutions with explanations',
    category: 'Programming',
    tags: ['code', 'programming', 'generation'],
    signature: {
      id: 'code-sig',
      name: 'Code Generation',
      description: 'Generate code with explanation',
      inputFields: [
        {
          id: 'input-1',
          name: 'problemDescription',
          type: 'string',
          description: 'Programming problem description',
          modifiers: [],
          isInput: true,
        },
      ],
      outputFields: [
        {
          id: 'output-1',
          name: 'pythonSolution',
          type: 'code',
          description: 'Python code solution',
          modifiers: [],
          isInput: false,
          codeLanguage: 'python',
        },
        {
          id: 'output-2',
          name: 'solutionExplanation',
          type: 'string',
          description: 'Explanation of the solution approach',
          modifiers: [],
          isInput: false,
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  },
  {
    id: 'data-extraction',
    name: 'Data Extraction',
    description: 'Extract structured data from unstructured text',
    category: 'Data Processing',
    tags: ['extraction', 'structured-data', 'analysis'],
    signature: {
      id: 'extraction-sig',
      name: 'Data Extraction',
      description: 'Extract structured information',
      inputFields: [
        {
          id: 'input-1',
          name: 'customerFeedback',
          type: 'string',
          description: 'Customer feedback text',
          modifiers: [],
          isInput: true,
        },
      ],
      outputFields: [
        {
          id: 'output-1',
          name: 'extractedTopics',
          type: 'array',
          description: 'List of topics mentioned',
          modifiers: [],
          isInput: false,
          arrayElementType: 'string',
        },
        {
          id: 'output-2',
          name: 'urgencyLevel',
          type: 'class',
          description: 'Urgency classification',
          modifiers: [],
          isInput: false,
          classOptions: ['low', 'medium', 'high'],
        },
        {
          id: 'output-3',
          name: 'actionItems',
          type: 'array',
          description: 'Required action items',
          modifiers: ['optional'],
          isInput: false,
          arrayElementType: 'string',
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  },
];

const FIELD_TYPES: { value: FieldType; label: string; description: string }[] =
  [
    { value: 'string', label: 'String', description: 'Text field' },
    { value: 'number', label: 'Number', description: 'Numeric value' },
    { value: 'boolean', label: 'Boolean', description: 'True/false value' },
    { value: 'date', label: 'Date', description: 'Date field' },
    {
      value: 'datetime',
      label: 'DateTime',
      description: 'Date and time field',
    },
    { value: 'image', label: 'Image', description: 'Image file' },
    { value: 'audio', label: 'Audio', description: 'Audio file' },
    { value: 'json', label: 'JSON', description: 'Structured JSON data' },
    { value: 'code', label: 'Code', description: 'Code block with language' },
    {
      value: 'class',
      label: 'Classification',
      description: 'Multiple choice field',
    },
    { value: 'array', label: 'Array', description: 'List of values' },
  ];

const MODIFIER_TYPES: {
  value: ModifierType;
  label: string;
  description: string;
}[] = [
  {
    value: 'optional',
    label: 'Optional',
    description: 'Field is not required',
  },
  {
    value: 'internal',
    label: 'Internal',
    description: 'Internal processing field',
  },
];

export default function SignatureBuilder() {
  const [activeTab, setActiveTab] = useState('builder');
  const [signature, setSignature] = useState<SignatureDefinition>({
    id: `sig-${Date.now()}`,
    name: 'My Signature',
    description: '',
    inputFields: [
      {
        id: 'input-1',
        name: 'userQuestion',
        type: 'string',
        description: 'User input question',
        modifiers: [],
        isInput: true,
      },
    ],
    outputFields: [
      {
        id: 'output-1',
        name: 'assistantResponse',
        type: 'string',
        description: 'AI assistant response',
        modifiers: [],
        isInput: false,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const [testInputs, setTestInputs] = useState<Record<string, any>>({});
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const addField = useCallback((isInput: boolean) => {
    const newField: SignatureField = {
      id: `${isInput ? 'input' : 'output'}-${Date.now()}`,
      name: isInput ? 'newInput' : 'newOutput',
      type: 'string',
      description: '',
      modifiers: [],
      isInput,
    };

    setSignature((prev) => ({
      ...prev,
      [isInput ? 'inputFields' : 'outputFields']: [
        ...prev[isInput ? 'inputFields' : 'outputFields'],
        newField,
      ],
      updatedAt: new Date(),
    }));
  }, []);

  const removeField = useCallback((fieldId: string, isInput: boolean) => {
    setSignature((prev) => ({
      ...prev,
      [isInput ? 'inputFields' : 'outputFields']: prev[
        isInput ? 'inputFields' : 'outputFields'
      ].filter((f) => f.id !== fieldId),
      updatedAt: new Date(),
    }));
  }, []);

  const updateField = useCallback(
    (fieldId: string, updates: Partial<SignatureField>) => {
      setSignature((prev) => {
        const updateFields = (fields: SignatureField[]) =>
          fields.map((field) =>
            field.id === fieldId ? { ...field, ...updates } : field
          );

        return {
          ...prev,
          inputFields: updateFields(prev.inputFields),
          outputFields: updateFields(prev.outputFields),
          updatedAt: new Date(),
        };
      });
    },
    []
  );

  const loadTemplate = useCallback((template: SignatureTemplate) => {
    setSignature(template.signature);
    setTestInputs({});
    setExecutionResult(null);
  }, []);

  const generateSignatureCode = useCallback(() => {
    const inputParts = signature.inputFields.map((field) => {
      let fieldDef = `${field.name}:\${f.${field.type}('${field.description}')`;

      if (field.type === 'class' && field.classOptions) {
        fieldDef = `${field.name}:\${f.class([${field.classOptions.map((opt) => `'${opt}'`).join(', ')}], '${field.description}')}`;
      } else if (field.type === 'array' && field.arrayElementType) {
        fieldDef = `${field.name}:\${f.${field.arrayElementType}('${field.description}').array()}`;
      } else if (field.type === 'code' && field.codeLanguage) {
        fieldDef = `${field.name}:\${f.code('${field.codeLanguage}', '${field.description}')}`;
      }

      // Apply modifiers
      field.modifiers.forEach((modifier) => {
        fieldDef = fieldDef
          .replace(':${', `:\${f.${modifier}(`)
          .replace('}', ')})');
      });

      return fieldDef;
    });

    const outputParts = signature.outputFields.map((field) => {
      let fieldDef = `${field.name}:\${f.${field.type}('${field.description}')`;

      if (field.type === 'class' && field.classOptions) {
        fieldDef = `${field.name}:\${f.class([${field.classOptions.map((opt) => `'${opt}'`).join(', ')}], '${field.description}')}`;
      } else if (field.type === 'array' && field.arrayElementType) {
        fieldDef = `${field.name}:\${f.${field.arrayElementType}('${field.description}').array()}`;
      } else if (field.type === 'code' && field.codeLanguage) {
        fieldDef = `${field.name}:\${f.code('${field.codeLanguage}', '${field.description}')}`;
      }

      // Apply modifiers
      field.modifiers.forEach((modifier) => {
        fieldDef = fieldDef
          .replace(':${', `:\${f.${modifier}(`)
          .replace('}', ')})');
      });

      return fieldDef;
    });

    const signatureParts = [...inputParts, '->', ...outputParts].join(',\n  ');

    return `// ${signature.description || signature.name}
const ${signature.name.replace(/\s+/g, '')} = ax\`
  ${signatureParts}
\`;`;
  }, [signature]);

  const executeSignature = useCallback(async () => {
    setIsExecuting(true);
    setExecutionResult(null);

    try {
      // Simulate AI execution
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Generate mock outputs based on field types
      const outputs: Record<string, any> = {};

      signature.outputFields.forEach((field) => {
        switch (field.type) {
          case 'string':
            outputs[field.name] =
              `Generated ${field.description.toLowerCase()} based on the input`;
            break;
          case 'number':
            outputs[field.name] = Math.random();
            break;
          case 'boolean':
            outputs[field.name] = Math.random() > 0.5;
            break;
          case 'class':
            outputs[field.name] = field.classOptions?.[0] || 'unknown';
            break;
          case 'array':
            outputs[field.name] = ['Item 1', 'Item 2', 'Item 3'];
            break;
          case 'code':
            outputs[field.name] = `def example():\n    return "Hello, World!"`;
            break;
          case 'json':
            outputs[field.name] = { result: 'success', data: {} };
            break;
          default:
            outputs[field.name] = `Mock ${field.type} output`;
        }
      });

      setExecutionResult({
        inputs: testInputs,
        outputs,
        executedAt: new Date(),
        duration: 1500,
        success: true,
      });
    } catch (error) {
      setExecutionResult({
        inputs: testInputs,
        outputs: {},
        executedAt: new Date(),
        duration: 1500,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsExecuting(false);
    }
  }, [signature, testInputs]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>DSPy Signature Builder</CardTitle>
          <CardDescription>
            Build, test, and export Ax signatures with a visual interface
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger
                value="builder"
                onClick={() => setActiveTab('builder')}
                isActive={activeTab === 'builder'}
              >
                Builder
              </TabsTrigger>
              <TabsTrigger
                value="templates"
                onClick={() => setActiveTab('templates')}
                isActive={activeTab === 'templates'}
              >
                Templates
              </TabsTrigger>
              <TabsTrigger
                value="test"
                onClick={() => setActiveTab('test')}
                isActive={activeTab === 'test'}
              >
                Test
              </TabsTrigger>
              <TabsTrigger
                value="export"
                onClick={() => setActiveTab('export')}
                isActive={activeTab === 'export'}
              >
                Export
              </TabsTrigger>
            </TabsList>

            <TabsContent value="builder" activeValue={activeTab}>
              <div className="space-y-6">
                {/* Signature Metadata */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Signature Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block font-medium text-sm">
                          Name
                        </label>
                        <Input
                          value={signature.name}
                          onChange={(e) =>
                            setSignature((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
                          placeholder="Signature name"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block font-medium text-sm">
                          Description
                        </label>
                        <Input
                          value={signature.description || ''}
                          onChange={(e) =>
                            setSignature((prev) => ({
                              ...prev,
                              description: e.target.value,
                            }))
                          }
                          placeholder="Optional description"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Input Fields */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">Input Fields</CardTitle>
                      <CardDescription>
                        Define the input parameters for your signature
                      </CardDescription>
                    </div>
                    <Button onClick={() => addField(true)} size="sm">
                      <PlusIcon className="mr-2 h-4 w-4" />
                      Add Input
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {signature.inputFields.map((field, _index) => (
                      <FieldEditor
                        key={field.id}
                        field={field}
                        onUpdate={(updates) => updateField(field.id, updates)}
                        onRemove={() => removeField(field.id, true)}
                        canRemove={signature.inputFields.length > 1}
                      />
                    ))}
                  </CardContent>
                </Card>

                {/* Output Fields */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">Output Fields</CardTitle>
                      <CardDescription>
                        Define the expected outputs from your signature
                      </CardDescription>
                    </div>
                    <Button onClick={() => addField(false)} size="sm">
                      <PlusIcon className="mr-2 h-4 w-4" />
                      Add Output
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {signature.outputFields.map((field, _index) => (
                      <FieldEditor
                        key={field.id}
                        field={field}
                        onUpdate={(updates) => updateField(field.id, updates)}
                        onRemove={() => removeField(field.id, false)}
                        canRemove={signature.outputFields.length > 1}
                      />
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="templates" activeValue={activeTab}>
              <div className="space-y-4">
                <h3 className="font-semibold text-lg">Signature Templates</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {SIGNATURE_TEMPLATES.map((template) => (
                    <Card
                      key={template.id}
                      className="cursor-pointer transition-shadow hover:shadow-md"
                    >
                      <CardHeader>
                        <CardTitle className="text-base">
                          {template.name}
                        </CardTitle>
                        <CardDescription>
                          {template.description}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-1">
                            {template.tags.map((tag) => (
                              <Badge
                                key={tag}
                                variant="secondary"
                                className="text-xs"
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                          <Button
                            onClick={() => loadTemplate(template)}
                            className="w-full"
                            size="sm"
                          >
                            Load Template
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="test" activeValue={activeTab}>
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Test Inputs</CardTitle>
                    <CardDescription>
                      Provide test data for your signature inputs
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {signature.inputFields.map((field) => (
                      <div key={field.id}>
                        <label className="mb-2 block font-medium text-sm">
                          {field.name}
                          <span className="ml-1 text-muted-foreground">
                            ({field.type})
                          </span>
                        </label>
                        <TestInputField
                          field={field}
                          value={testInputs[field.name]}
                          onChange={(value) =>
                            setTestInputs((prev) => ({
                              ...prev,
                              [field.name]: value,
                            }))
                          }
                        />
                      </div>
                    ))}
                    <Button
                      onClick={executeSignature}
                      disabled={isExecuting}
                      className="w-full"
                    >
                      {isExecuting ? (
                        <>
                          <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          Executing...
                        </>
                      ) : (
                        <>
                          <PlayIcon className="mr-2 h-4 w-4" />
                          Execute Signature
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                {executionResult && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">
                        Execution Result
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div className="text-muted-foreground text-sm">
                          Executed at:{' '}
                          {executionResult.executedAt.toLocaleString()}
                          <span className="ml-4">
                            Duration: {executionResult.duration}ms
                          </span>
                          <Badge
                            variant={
                              executionResult.success
                                ? 'default'
                                : 'destructive'
                            }
                            className="ml-4"
                          >
                            {executionResult.success ? 'Success' : 'Error'}
                          </Badge>
                        </div>

                        {executionResult.success ? (
                          <div className="space-y-3">
                            {signature.outputFields.map((field) => (
                              <div
                                key={field.id}
                                className="rounded border p-3"
                              >
                                <div className="font-medium text-sm">
                                  {field.name}
                                </div>
                                <div className="mb-2 text-muted-foreground text-xs">
                                  {field.description}
                                </div>
                                <div className="rounded bg-muted p-2 font-mono text-sm">
                                  {JSON.stringify(
                                    executionResult.outputs[field.name],
                                    null,
                                    2
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-red-600 text-sm">
                            Error: {executionResult.error}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            <TabsContent value="export" activeValue={activeTab}>
              <div className="space-y-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">Generated Code</CardTitle>
                      <CardDescription>
                        Copy the generated Ax signature code
                      </CardDescription>
                    </div>
                    <Button
                      onClick={() => copyToClipboard(generateSignatureCode())}
                      size="sm"
                    >
                      <CopyIcon className="mr-2 h-4 w-4" />
                      Copy
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
                      <code>{generateSignatureCode()}</code>
                    </pre>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Usage Example</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
                      <code>{`// Import Ax
import { AxAI, ax, f } from '@ax-llm/ax';

// Initialize AI provider
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY
});

${generateSignatureCode()}

// Execute the signature
const result = await ${signature.name.replace(/\s+/g, '')}.forward(ai, {
${signature.inputFields.map((field) => `  ${field.name}: "your input here"`).join(',\n')}
});

console.log(result);`}</code>
                    </pre>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

// Field Editor Component
interface FieldEditorProps {
  field: SignatureField;
  onUpdate: (updates: Partial<SignatureField>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function FieldEditor({
  field,
  onUpdate,
  onRemove,
  canRemove,
}: FieldEditorProps) {
  const toggleModifier = (modifier: ModifierType) => {
    const newModifiers = field.modifiers.includes(modifier)
      ? field.modifiers.filter((m) => m !== modifier)
      : [...field.modifiers, modifier];
    onUpdate({ modifiers: newModifiers });
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block font-medium text-sm">Field Name</label>
            <Input
              value={field.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              placeholder="fieldName"
            />
          </div>
          <div>
            <label className="mb-1 block font-medium text-sm">Type</label>
            <Select
              value={field.type}
              onChange={(e) => onUpdate({ type: e.target.value as FieldType })}
            >
              {FIELD_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block font-medium text-sm">
              Description
            </label>
            <Input
              value={field.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
              placeholder="Field description"
            />
          </div>
        </div>
        {canRemove && (
          <Button
            onClick={onRemove}
            variant="destructive"
            size="sm"
            className="ml-4"
          >
            <TrashIcon className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Type-specific configurations */}
      {field.type === 'class' && (
        <div>
          <label className="mb-1 block font-medium text-sm">
            Class Options (comma-separated)
          </label>
          <Input
            value={field.classOptions?.join(', ') || ''}
            onChange={(e) =>
              onUpdate({
                classOptions: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="option1, option2, option3"
          />
        </div>
      )}

      {field.type === 'array' && (
        <div>
          <label className="mb-1 block font-medium text-sm">
            Array Element Type
          </label>
          <Select
            value={field.arrayElementType || 'string'}
            onChange={(e) =>
              onUpdate({ arrayElementType: e.target.value as FieldType })
            }
          >
            {FIELD_TYPES.filter((t) => t.value !== 'array').map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      {field.type === 'code' && (
        <div>
          <label className="mb-1 block font-medium text-sm">
            Programming Language
          </label>
          <Select
            value={field.codeLanguage || 'python'}
            onChange={(e) => onUpdate({ codeLanguage: e.target.value })}
          >
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="java">Java</option>
            <option value="cpp">C++</option>
            <option value="rust">Rust</option>
            <option value="go">Go</option>
          </Select>
        </div>
      )}

      {/* Modifiers */}
      <div>
        <label className="mb-2 block font-medium text-sm">Modifiers</label>
        <div className="flex gap-2">
          {MODIFIER_TYPES.map((modifier) => (
            <Button
              key={modifier.value}
              onClick={() => toggleModifier(modifier.value)}
              variant={
                field.modifiers.includes(modifier.value) ? 'default' : 'outline'
              }
              size="sm"
            >
              {modifier.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Test Input Field Component
interface TestInputFieldProps {
  field: SignatureField;
  value: any;
  onChange: (value: any) => void;
}

function TestInputField({ field, value, onChange }: TestInputFieldProps) {
  switch (field.type) {
    case 'string':
      return (
        <Textarea
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.description}
          rows={3}
        />
      );
    case 'number':
      return (
        <Input
          type="number"
          value={value || ''}
          onChange={(e) => onChange(Number.parseFloat(e.target.value) || 0)}
          placeholder={field.description}
        />
      );
    case 'boolean':
      return (
        <Select
          value={value?.toString() || 'false'}
          onChange={(e) => onChange(e.target.value === 'true')}
        >
          <option value="true">True</option>
          <option value="false">False</option>
        </Select>
      );
    case 'class':
      return (
        <Select value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select option...</option>
          {field.classOptions?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    case 'array':
      return (
        <Textarea
          value={Array.isArray(value) ? value.join('\n') : ''}
          onChange={(e) => onChange(e.target.value.split('\n').filter(Boolean))}
          placeholder="Enter each item on a new line"
          rows={4}
        />
      );
    default:
      return (
        <Input
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.description}
        />
      );
  }
}
