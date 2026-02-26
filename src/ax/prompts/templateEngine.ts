import { promptTemplates, type TemplateId } from './templates.generated.js';

type TemplateVars = Record<string, unknown>;

type Token =
  | { type: 'text'; value: string }
  | { type: 'tag'; value: string; index: number };

type TemplateNode =
  | { type: 'text'; value: string }
  | { type: 'var'; name: string; index: number }
  | {
      type: 'if';
      condition: string;
      thenNodes: readonly TemplateNode[];
      elseNodes: readonly TemplateNode[];
      index: number;
    };

type ParseResult = {
  nodes: readonly TemplateNode[];
  nextIndex: number;
  terminator?: 'else' | '/if';
};

const TAG_PATTERN = /{{\s*([^}]+?)\s*}}/g;
const IDENTIFIER_PATTERN =
  /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

const parsedTemplates = new Map<TemplateId, readonly TemplateNode[]>();

function formatError(
  context: string,
  source: string,
  index: number,
  message: string
): string {
  const snippet = source.slice(0, index);
  const lines = snippet.split('\n');
  const line = lines.length;
  const column = (lines.at(-1)?.length ?? 0) + 1;
  return `${context}:${line}:${column} ${message}`;
}

function tokenize(template: string): readonly Token[] {
  const tokens: Token[] = [];

  let lastIndex = 0;
  TAG_PATTERN.lastIndex = 0;

  let match = TAG_PATTERN.exec(template);
  while (match) {
    const [raw, expression] = match;
    const start = match.index;

    if (start > lastIndex) {
      tokens.push({
        type: 'text',
        value: template.slice(lastIndex, start),
      });
    }

    tokens.push({
      type: 'tag',
      value: expression.trim(),
      index: start,
    });

    lastIndex = start + raw.length;
    match = TAG_PATTERN.exec(template);
  }

  if (lastIndex < template.length) {
    tokens.push({ type: 'text', value: template.slice(lastIndex) });
  }

  return tokens;
}

function parseNodes(
  tokens: readonly Token[],
  source: string,
  context: string,
  startIndex = 0,
  terminators: ReadonlySet<'else' | '/if'> = new Set()
): ParseResult {
  const nodes: TemplateNode[] = [];

  let i = startIndex;
  while (i < tokens.length) {
    const token = tokens[i]!;

    if (token.type === 'text') {
      nodes.push({ type: 'text', value: token.value });
      i++;
      continue;
    }

    const tag = token.value;

    if (terminators.has(tag as 'else' | '/if')) {
      return {
        nodes,
        nextIndex: i,
        terminator: tag as 'else' | '/if',
      };
    }

    if (tag.startsWith('if ')) {
      const condition = tag.slice(3).trim();
      if (!IDENTIFIER_PATTERN.test(condition)) {
        throw new Error(
          formatError(
            context,
            source,
            token.index,
            `Invalid if condition '${condition}'`
          )
        );
      }

      const thenResult = parseNodes(
        tokens,
        source,
        context,
        i + 1,
        new Set(['else', '/if'])
      );

      if (!thenResult.terminator) {
        throw new Error(
          formatError(context, source, token.index, "Unclosed 'if' block")
        );
      }

      let elseNodes: readonly TemplateNode[] = [];
      let nextIndex = thenResult.nextIndex + 1;

      if (thenResult.terminator === 'else') {
        const elseResult = parseNodes(
          tokens,
          source,
          context,
          thenResult.nextIndex + 1,
          new Set(['/if'])
        );

        if (elseResult.terminator !== '/if') {
          throw new Error(
            formatError(context, source, token.index, "Unclosed 'if' block")
          );
        }

        elseNodes = elseResult.nodes;
        nextIndex = elseResult.nextIndex + 1;
      }

      nodes.push({
        type: 'if',
        condition,
        thenNodes: thenResult.nodes,
        elseNodes,
        index: token.index,
      });

      i = nextIndex;
      continue;
    }

    if (tag === 'else') {
      throw new Error(
        formatError(context, source, token.index, "Unexpected 'else'")
      );
    }

    if (tag === '/if') {
      throw new Error(
        formatError(context, source, token.index, "Unexpected '/if'")
      );
    }

    if (tag.startsWith('include ')) {
      throw new Error(
        formatError(
          context,
          source,
          token.index,
          "Unexpected 'include' directive at runtime (includes must be compiled)"
        )
      );
    }

    if (!IDENTIFIER_PATTERN.test(tag)) {
      throw new Error(
        formatError(context, source, token.index, `Invalid tag '${tag}'`)
      );
    }

    nodes.push({ type: 'var', name: tag, index: token.index });
    i++;
  }

  return { nodes, nextIndex: i };
}

function resolveVar(
  vars: Readonly<TemplateVars>,
  path: string,
  source: string,
  context: string,
  index: number
): unknown {
  const parts = path.split('.');
  let current: unknown = vars;

  for (const part of parts) {
    if (current === null || typeof current !== 'object' || !(part in current)) {
      throw new Error(
        formatError(
          context,
          source,
          index,
          `Missing template variable '${path}'`
        )
      );
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function renderNodes(
  nodes: readonly TemplateNode[],
  vars: Readonly<TemplateVars>,
  source: string,
  context: string
): string {
  let output = '';

  for (const node of nodes) {
    if (node.type === 'text') {
      output += node.value;
      continue;
    }

    if (node.type === 'var') {
      const value = resolveVar(vars, node.name, source, context, node.index);
      if (
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      ) {
        throw new Error(
          formatError(
            context,
            source,
            node.index,
            `Variable '${node.name}' must be string, number, or boolean`
          )
        );
      }
      output += String(value);
      continue;
    }

    const conditionValue = resolveVar(
      vars,
      node.condition,
      source,
      context,
      node.index
    );

    if (typeof conditionValue !== 'boolean') {
      throw new Error(
        formatError(
          context,
          source,
          node.index,
          `Condition '${node.condition}' must be boolean`
        )
      );
    }

    if (conditionValue) {
      output += renderNodes(node.thenNodes, vars, source, context);
    } else {
      output += renderNodes(node.elseNodes, vars, source, context);
    }
  }

  return output;
}

function parseTemplate(
  template: string,
  context: string
): readonly TemplateNode[] {
  const tokens = tokenize(template);
  const result = parseNodes(tokens, template, context);

  if (result.terminator) {
    throw new Error(
      `Unexpected template terminator '${result.terminator}' in ${context}`
    );
  }

  return result.nodes;
}

export function renderTemplateContent(
  template: string,
  vars: Readonly<TemplateVars> = {},
  context = 'inline-template'
): string {
  const ast = parseTemplate(template, context);
  return renderNodes(ast, vars, template, context);
}

export function renderPromptTemplate(
  templateId: TemplateId,
  vars: Readonly<TemplateVars> = {}
): string {
  const template = promptTemplates[templateId];
  const context = `template:${templateId}`;

  if (!template) {
    throw new Error(`Unknown template id: ${String(templateId)}`);
  }

  let ast = parsedTemplates.get(templateId);
  if (!ast) {
    ast = parseTemplate(template, context);
    parsedTemplates.set(templateId, ast);
  }

  return renderNodes(ast, vars, template, context);
}
