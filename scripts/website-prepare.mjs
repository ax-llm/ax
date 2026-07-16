#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  academyCourse,
  requiredAcademyCoverage,
} from '../website/content-src/academy/course.mjs';
import {
  exampleGroupLabels,
  groupPublicExamples,
  readPublicExampleCatalog,
} from './example-catalog.mjs';
import {
  buildAcademyPages,
  validateAcademyCourse,
  validateAcademyLanguages,
} from './website-academy.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const siteRoot = path.join(repoRoot, 'website');
const contentSrcRoot = path.join(siteRoot, 'content-src');
const generatedContentRoot = path.join(siteRoot, '.generated', 'content');
const githubBlob = 'https://github.com/ax-llm/ax/blob/main';
const skillDiscoverySchema =
  'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

const subsystemHeadings = {
  ai: 'LLM provider, model, media, routing, and embedding APIs.',
  ax: 'Structured generation APIs for typed programs.',
  s: 'Signature, field, schema, and validation APIs.',
  agent:
    'Agent, RLM runtime, context, memory, skill, MCP, and delegation APIs.',
  optimize: 'GEPA, Pareto, artifact, and optimizer APIs.',
};

const subsystemAliases = {
  ai: new Set(['AxAI']),
  ax: new Set(['AxGen', 'Tools']),
  s: new Set(['Signatures']),
  agent: new Set(['Agents And RLM', 'Runtime Profiles', 'MCP']),
  optimize: new Set(['Optimizers']),
};

const typedocKeywordFallback = {
  ai: [
    'AxAI',
    'Provider',
    'Model',
    'Router',
    'Balancer',
    'Embedding',
    'Audio',
    'Realtime',
    'OpenAI',
    'Anthropic',
    'Gemini',
    'Cohere',
    'DeepSeek',
    'Mistral',
    'Reka',
    'Grok',
    'SupportedAIModels',
  ],
  ax: [
    'AxGen',
    'AxProgram',
    'PromptTemplate',
    'FunctionProcessor',
    'FunctionError',
    'Generate',
    'Assertion',
    'Streaming',
    'ax',
    'fn',
  ],
  s: ['Signature', 'Field', 'Schema', 'FluentField', 's', 'f'],
  agent: [
    'AxAgent',
    'agent',
    'Runtime',
    'RLM',
    'Memory',
    'Context',
    'Skill',
    'MCP',
    'Discovery',
    'Clarification',
  ],
  optimize: [
    'optimize',
    'GEPA',
    'Pareto',
    'Optimization',
    'Optimizer',
    'Bootstrap',
    'Demos',
  ],
};

const coreApiSymbols = {
  ai: new Set([
    'ai',
    'AxAI',
    'AxAIOpenAI',
    'AxAIOpenAIResponses',
    'AxAIAnthropic',
    'AxAIGoogleGemini',
    'AxBalancer',
    'MultiServiceRouter',
    'ProviderRouter',
    'OpenAICompatibleClient',
    'OpenAIResponsesClient',
    'AnthropicClient',
    'GoogleGeminiClient',
    'axGetSupportedAIModels',
  ]),
  ax: new Set([
    'ax',
    'AxGen',
    'fn',
    'AxFunction',
    'AxFunctionProcessor',
    'AxProgram',
    'AxGenerateError',
    'NewAx',
  ]),
  s: new Set([
    's',
    'f',
    'AxSignature',
    'AxSignatureConfig',
    'AxField',
    'AxFieldType',
    'FieldType',
    'S',
  ]),
  agent: new Set([
    'agent',
    'AxAgent',
    'AxAgentFunctionGroup',
    'AxAgentOptions',
    'AxMCPClient',
    'AxMCPStdioTransport',
    'AxMCPStreamableHTTPTransport',
    'NewAgent',
  ]),
  optimize: new Set([
    'optimize',
    'AxGEPA',
    'AxBootstrapFewShot',
    'AxOptimizedProgram',
    'OptimizerEngine',
    'OptimizerEvaluator',
  ]),
};

const skillNavLabels = new Map([
  ['llm', 'Quick Reference'],
  ['ai', 'AI'],
  ['audio', 'Audio'],
  ['signature', 'Signatures'],
  ['gen', 'Generation'],
  ['mcp', 'MCP'],
  ['flow', 'Flow'],
  ['agent', 'Agent'],
  ['agent-rlm', 'Agent RLM'],
  ['agent-memory-skills', 'Memory & Skills'],
  ['agent-observability', 'Observability'],
  ['agent-optimize', 'Agent Optimize'],
  ['agent-context', 'Agent Context'],
  ['event-runtime', 'Event Runtime'],
  ['gepa', 'GEPA'],
  ['refine', 'Refinement'],
]);

const skillNavOrder = [
  'llm',
  'ai',
  'audio',
  'signature',
  'gen',
  'mcp',
  'flow',
  'agent',
  'agent-rlm',
  'agent-memory-skills',
  'agent-observability',
  'agent-optimize',
  'agent-context',
  'event-runtime',
  'gepa',
  'refine',
];

await rm(generatedContentRoot, { recursive: true, force: true });
await mkdir(generatedContentRoot, { recursive: true });
await copyMermaidVendor();

const siteMap = await readJson(path.join(contentSrcRoot, 'site-map.json'));
const languages = await readLanguages(siteMap.languages);
const templates = await readTemplates();
const inventory = await buildInventory(languages);
await writeSkillInstallIndexes(languages, inventory.languageSkills);
const navPages = siteMap.navGroups.flatMap((group, groupIndex) =>
  group.pages.map((page, pageIndex) => ({
    ...page,
    group: group.id,
    groupTitle: group.title,
    weight: groupIndex * 100 + pageIndex + 1,
  }))
);

for (const language of languages) {
  await writeRedirectPage(`${language.id}/_index.md`, {
    title: `${language.label} Documentation`,
    description: `Ax documentation for ${language.label}.`,
    language,
    redirectTo: `/${language.id}/quick-start/`,
  });

  for (const page of navPages) {
    // Pages may opt into a subset of languages (e.g. a TS-only feature whose
    // API is not yet ported to the generated languages).
    if (page.languages && !page.languages.includes(language.id)) {
      continue;
    }
    await writeGeneratedDocPage(language, page);
  }

  for (const redirect of siteMap.redirects ?? []) {
    await writeRedirectPage(`${language.id}/${redirect.from}/_index.md`, {
      title: redirect.title,
      description: redirect.description,
      language,
      redirectTo: `/${language.id}/${redirect.to}/`,
      linkText: redirect.title,
    });
  }

  await writeExampleGroupPages(language, navPages);
  await writeLanguageSkillPages(
    language,
    inventory.languageSkills[language.id] ?? [],
    navPages
  );

  await writeLanguageReferencePage(language);
  if (language.apiKind === 'typedoc') {
    await writeTypeScriptReferencePages(language);
  }
}

await validateAcademyCourse(academyCourse, {
  repoRoot,
  publicExports: inventory.publicExports,
  requiredCoverage: requiredAcademyCoverage,
});
await validateAcademyLanguages(academyCourse, languages, { repoRoot });
for (const language of languages) {
  for (const academyPage of buildAcademyPages(academyCourse, language)) {
    await writePage(academyPage.relPath, academyPage.page);
  }
}

await writeInventoryPage(languages);

console.log(
  `website generated content: ${path.relative(repoRoot, generatedContentRoot)}`
);

async function writeGeneratedDocPage(language, page) {
  const template = templates.get(page.template);
  if (!template) {
    throw new Error(`Missing website template: ${page.template}`);
  }

  const context = await renderContext(language, page);
  const body = renderTemplate(template, context);
  const unresolved = [
    ...new Set(
      [...body.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g)].map((m) => m[1])
    ),
  ];
  if (unresolved.length > 0) {
    throw new Error(
      `Unresolved template placeholders in ${page.template} (${language.id}): ${unresolved.join(', ')}`
    );
  }
  await writePage(`${language.id}/${page.slug}/_index.md`, {
    title: page.title,
    description: page.description,
    weight: page.weight,
    generated: true,
    language: language.id,
    slug_key: page.slug,
    nav_group: page.group,
    section_nav: page.sectionNav ?? sectionNavForPage(page),
    body_class: page.bodyClass ?? `docs-${sectionNavForPage(page)}`,
    toc: page.toc ?? page.group !== 'api',
    source: context.source,
    body,
  });
}

async function writeLanguageSkillPages(language, skills, navPages) {
  if (skills.length === 0) return;

  const skillsIndex = navPages.find(
    (page) => page.group === 'skills' && page.slug === 'skills'
  );
  const baseWeight = (skillsIndex?.weight ?? 400) + 1;

  for (const [index, skill] of skills.entries()) {
    const slug = skillPageSlug(skill);
    const title = skillNavTitle(language, skill);
    await writePage(`${language.id}/skills/${slug}/_index.md`, {
      title,
      description: skill.description,
      weight: baseWeight + index,
      generated: true,
      language: language.id,
      slug_key: skillSlugKey(language, skill),
      nav_group: 'skills',
      section_nav: 'skills',
      body_class: 'docs-skills',
      toc: true,
      source: skill.source,
      body: renderSkillPage(language, skill),
    });
  }
}

async function writeExampleGroupPages(language, navPages) {
  const examplesIndex = navPages.find(
    (page) => page.group === 'examples' && page.slug === 'examples'
  );
  const examples = inventory.examples[language.id] ?? [];
  const groups = groupPublicExamples(examples);
  const baseWeight = examplesIndex?.weight ?? 2;

  for (const [index, group] of groups.entries()) {
    await writePage(`${language.id}/examples/${group.slug}/_index.md`, {
      title: group.title,
      description: `${group.title} — ${language.label} examples backed by real provider calls.`,
      weight: baseWeight + index + 1,
      generated: true,
      language: language.id,
      slug_key: `examples/${group.slug}`,
      nav_group: 'examples',
      section_nav: 'examples',
      body_class: 'docs-examples',
      toc: true,
      source: `src/examples/${language.id}/${group.slug}`,
      body: renderExampleGroupPage(language, group),
    });
  }
}

function sectionNavForPage(page) {
  if (page.slug === 'quick-start') return 'quick-start';
  if (page.slug === 'advanced-start') return 'quick-start';
  if (page.slug.startsWith('examples')) return 'examples';
  if (page.slug === 'skills') return 'skills';
  return page.group;
}

async function renderContext(language, page) {
  const subsystem = page.subsystem ?? subsystemFromSlug(page.slug);
  const langRoot = `/${language.id}`;
  const snippets = language.snippets ?? {};
  const examples = inventory.examples[language.id] ?? [];
  const packageInventory = inventory.packages[language.id];

  const apiRows = apiRowsFor(language, subsystem, inventory);
  const context = {
    title: page.title,
    language: language.label,
    languageId: language.id,
    packageName: language.packageName,
    optimizeName: language.optimizeName ?? 'optimize()',
    optimizeIntro:
      language.optimizeIntro ??
      'Use optimize() for normal GEPA tuning. It accepts a programmable root, training examples, a metric, and optimizer options.',
    langRoot,
    fence: language.fence,
    shellFence: 'bash',
    install: (language.install ?? []).join('\n'),
    skillInstallURL: skillInstallURL(language),
    skillInstallCommand: skillInstallCommand(language),
    skillList: skillList(inventory.languageSkills[language.id] ?? [], language),
    skillSource: skillSource(language),
    quickStartCode: lines(snippets.quickStart),
    dspyCode: lines(snippets.dspy ?? snippets.quickStart),
    signatureCode: lines(snippets.signature),
    signatureStringExample: snippetBlock(
      language,
      'signatures.string',
      'signature'
    ),
    signatureFluentExample: snippetBlock(language, 'signatures.fluent'),
    signatureValidationExample: snippetBlock(language, 'signatures.validation'),
    signatureHybridExample: snippetBlock(language, 'signatures.hybrid'),
    standardSchemaSection: standardSchemaSection(language),
    toolsBasicExample: snippetBlock(language, 'tools.basic'),
    toolsStandardSchemaExample: snippetBlock(language, 'tools.standardSchema'),
    toolsNamespacesExample: snippetBlock(language, 'tools.namespaces'),
    toolsAxExample: snippetBlock(language, 'tools.ax'),
    toolsAgentFlatExample: snippetBlock(language, 'tools.agentFlat'),
    toolsAgentGroupsExample: snippetBlock(language, 'tools.agentGroups'),
    axCode: lines(snippets.ax),
    axToolsExample: snippetBlock(language, 'ax.tools', 'ax'),
    axStreamingExample: snippetBlock(language, 'ax.streaming'),
    axMCPExample: snippetBlock(language, 'mcp.axTools'),
    agentCode: lines(snippets.agent),
    agentMinimalExample: snippetBlock(language, 'agents.minimal', 'agent'),
    agentToolsExample: snippetBlock(language, 'tools.agentFlat', 'agent'),
    agentDiscoveryExample: snippetBlock(language, 'agents.discovery', 'agent'),
    agentMemoryExample: snippetBlock(language, 'agents.memory', 'agent'),
    agentContextPolicyExample: snippetBlock(
      language,
      'agents.contextPolicy',
      'agent'
    ),
    agentOptimizeExample: snippetBlock(language, 'agents.optimize', 'agent'),
    agentPlaybookEvolveExample: snippetBlock(language, 'agents.playbookEvolve'),
    agentLongHorizonExample: snippetBlock(
      language,
      'agents.longHorizon',
      'agent'
    ),
    agentGroundedAuditExample: snippetBlock(
      language,
      'agents.groundedAudit',
      'agent'
    ),
    agentMCPFlatExample: snippetBlock(language, 'mcp.agentFlat'),
    agentMCPGroupedExample: snippetBlock(language, 'mcp.agentGrouped'),
    mcpStdioExample: snippetBlock(language, 'mcp.stdio'),
    mcpHttpExample: snippetBlock(language, 'mcp.http'),
    mcpOAuthExample: snippetBlock(language, 'mcp.oauth'),
    mcpScriptedExample: snippetBlock(language, 'mcp.scripted'),
    mcpCapabilitiesExample: snippetBlock(language, 'mcp.capabilities'),
    mcpOverridesExample: snippetBlock(language, 'mcp.overrides'),
    mcpNativeExample: snippetBlock(language, 'mcp.native'),
    mcpResourceWakeExample: snippetBlock(language, 'mcp.resourceWake'),
    mcpTaskResumeExample: snippetBlock(language, 'mcp.taskResume'),
    eventWakeExample: snippetBlock(language, 'event.wake'),
    eventResumeExample: snippetBlock(language, 'event.resume'),
    eventUCPExample: snippetBlock(language, 'event.ucp'),
    llmCode: snippetCode(language, 'ai.openai', 'llm'),
    aiOpenAIExample: snippetBlock(language, 'ai.openai', 'llm'),
    aiResponsesExample: snippetBlock(language, 'ai.responses'),
    aiClaudeExample: snippetBlock(language, 'ai.claude'),
    aiGeminiExample: snippetBlock(language, 'ai.gemini'),
    aiCompatibleExample: snippetBlock(language, 'ai.compatible'),
    aiEmbeddingsExample: snippetBlock(language, 'ai.embeddings'),
    aiAudioExample: snippetBlock(language, 'ai.audio'),
    aiThinkingExample: snippetBlock(language, 'ai.thinking'),
    aiCatalogExample: snippetBlock(language, 'ai.catalog'),
    aiProviderExamples: aiProviderExamples(language),
    telemetryCode: lines(snippets.telemetry),
    optimizeCode: lines(snippets.optimize),
    playbookCode: lines(snippets.playbook),
    optimizeAxGenExample: snippetBlock(language, 'optimize.axgen', 'optimize'),
    optimizeFlowExample: snippetBlock(language, 'optimize.flow'),
    optimizeAgentExample: snippetBlock(language, 'optimize.agent'),
    optimizeArtifactExample: snippetBlock(language, 'optimize.artifact'),
    inventoryNote: inventoryNote(inventory, language),
    examplesLanding: examplesLanding(language, examples),
    advancedStart: advancedStart(language, examples),
    examplesSource: examplesSource(language),
    aiInventory: inventoryBullets(language, packageInventory, 'ai', inventory),
    axInventory: inventoryBullets(language, packageInventory, 'ax', inventory),
    signatureInventory: inventoryBullets(
      language,
      packageInventory,
      's',
      inventory
    ),
    agentInventory: inventoryBullets(
      language,
      packageInventory,
      'agent',
      inventory
    ),
    optimizeInventory: inventoryBullets(
      language,
      packageInventory,
      'optimize',
      inventory
    ),
    apiIntro: subsystemHeadings[subsystem] ?? 'Generated API entries.',
    apiCards: apiCards(apiRows, language, subsystem),
    apiReferenceLink: apiReferenceLink(language, subsystem),
    source: sourceForPage(language, page),
  };
  return context;
}

async function writeLanguageReferencePage(language) {
  if (language.apiKind === 'typedoc') {
    const body = [
      '# TypeScript Full API Reference',
      '',
      'The TypeScript reference is generated from TypeDoc markdown and grouped into the subsystem API pages.',
      '',
      typeDocReferenceList(inventory.typedocPages),
    ].join('\n');
    await writePage(`${language.id}/api/reference/_index.md`, {
      title: 'TypeScript Full API Reference',
      description: 'Generated TypeDoc API reference.',
      weight: 999,
      generated: true,
      language: language.id,
      slug_key: 'api/reference',
      section_nav: 'api',
      body_class: 'docs-api',
      toc: false,
      source: 'build/apidocs',
      body,
    });
    return;
  }

  const apiMarkdown = await readFile(
    path.join(repoRoot, 'packages', language.id, 'API.md'),
    'utf8'
  );
  await writePage(`${language.id}/api/reference/_index.md`, {
    title: `${language.label} Full API Reference`,
    description: `Generated ${language.label} API reference.`,
    weight: 999,
    generated: true,
    language: language.id,
    slug_key: 'api/reference',
    section_nav: 'api',
    body_class: 'docs-api',
    toc: false,
    source: `packages/${language.id}/API.md`,
    body: rewriteLanguageLinks(
      ensureMarkdownHeading(
        `${language.label} Full API Reference`,
        stripFrontmatter(apiMarkdown)
      ),
      language
    ),
  });
}

async function writeTypeScriptReferencePages(language) {
  for (const page of inventory.typedocPages) {
    await writePage(`${language.id}/api/reference/${page.slug}/_index.md`, {
      title: page.title,
      description: 'Generated TypeScript API reference.',
      weight: 1000,
      generated: true,
      language: language.id,
      slug_key: 'api/reference',
      section_nav: 'api',
      body_class: 'docs-api',
      toc: false,
      source: page.source,
      body: rewriteTypeDocLinks(ensureMarkdownHeading(page.title, page.body)),
    });
  }
}

async function writeInventoryPage(languages) {
  const rows = languages.map((language) => {
    const packageInventory = inventory.packages[language.id];
    const skillCount = inventory.languageSkills[language.id]?.length ?? 0;
    return `| ${language.label} | ${inventory.examples[language.id]?.length ?? 0} | ${
      packageInventory?.apiSections.length ?? inventory.typedocPages.length
    } | ${skillCount} | ${packageInventory?.capabilities?.provider_mode ?? 'reference'} |`;
  });

  await writePage('_inventory/_index.md', {
    title: 'Website Inventory',
    description: 'Source-audited website inventory.',
    weight: 9999,
    generated: true,
    language: siteMap.defaultLanguage,
    slug_key: '_inventory',
    section_nav: 'inventory',
    body_class: 'docs-inventory',
    toc: false,
    source: 'scripts/website-prepare.mjs',
    body: [
      '# Website Inventory',
      '',
      'This generated page is intentionally plain. It gives maintainers a quick way to see what the markdown site consumed.',
      '',
      `- Public TypeScript exports found: ${inventory.publicExports.size}`,
      `- TypeDoc pages found: ${inventory.typedocPages.length}`,
      `- Skill docs scanned: ${inventory.skillDocs.length}`,
      `- Example catalog source: \`${inventory.exampleCatalogSource}\``,
      '',
      '| Language | Examples | API rows | Skills | Provider mode |',
      '| --- | ---: | ---: | ---: | --- |',
      ...rows,
    ].join('\n'),
  });
}

async function buildInventory(languages) {
  const indexSource = await readFile(
    path.join(repoRoot, 'src/ax/index.ts'),
    'utf8'
  );
  const publicExports = parsePublicExports(indexSource);
  const typedocPages = await readTypeDocPages();
  const skillDocs = await readSkillDocs();
  const exampleCatalog = await readPublicExampleCatalog({ repoRoot });
  const examples = await readExamples(languages, exampleCatalog);
  const packages = await readPackageInventories(languages);
  const languageSkills = await readLanguageSkillCatalogs(languages);

  return {
    publicExports,
    typedocPages,
    skillDocs,
    exampleCatalogSource: exampleCatalog.source,
    examples,
    packages,
    languageSkills,
  };
}

function parsePublicExports(source) {
  const names = new Set();
  const regex = /^export (?:type )?\{([^}]+)\};/gm;
  for (const match of source.matchAll(regex)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

async function readTypeDocPages() {
  const apiRoot = path.join(repoRoot, 'build/apidocs');
  if (!(await exists(apiRoot))) return [];

  const files = (await listFiles(apiRoot)).filter((file) =>
    file.endsWith('.md')
  );
  const pages = [];
  for (const file of files) {
    const rel = path.relative(apiRoot, file).replaceAll(path.sep, '/');
    const raw = await readFile(file, 'utf8');
    const body = stripFrontmatter(raw);
    const title = parseFrontmatterTitle(raw) ?? titleFromFile(rel);
    const slug =
      rel === 'index.md' || rel === 'README.md' ? 'index' : typedocSlug(rel);
    pages.push({
      rel,
      slug,
      title,
      body,
      ...parseTypeDocDetails(body),
      source: `build/apidocs/${rel}`,
    });
  }
  pages.sort((a, b) => a.title.localeCompare(b.title));
  return pages;
}

function parseTypeDocDetails(markdown) {
  const callSignatures = [
    ...markdown.matchAll(
      /## Call Signature[\s\S]*?```(?:ts|typescript)\n([\s\S]*?)```/g
    ),
  ].map((match) => match[1].trim());

  if (callSignatures.length === 0) {
    const firstTsBlock = markdown.match(/```(?:ts|typescript)\n([\s\S]*?)```/);
    if (firstTsBlock) callSignatures.push(firstTsBlock[1].trim());
  }

  const definedIn = markdown.match(/^Defined in:\s*(.+)$/m)?.[1]?.trim();
  const description = extractDescription(markdown);
  const parameters = parseMarkdownTable(
    sectionByHeading(markdown, 'Parameters')
  );
  const returns = compactMarkdownText(sectionByHeading(markdown, 'Returns'));
  const examples = extractCodeBlocks(sectionByHeading(markdown, 'Examples'));

  return {
    callSignatures,
    definedIn,
    description,
    parameters,
    returns,
    examples,
  };
}

function extractDescription(markdown) {
  const afterDefinedIn = markdown.match(
    /^Defined in:\s*.+\n([\s\S]*?)(?:\n#{2,3}\s|\n$)/m
  );
  if (!afterDefinedIn) return undefined;

  const text = afterDefinedIn[1]
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(
      (line) => line.trim() && !line.startsWith('**') && !line.startsWith('```')
    )
    .join('\n')
    .trim();

  return text || undefined;
}

function sectionByHeading(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => {
    const match = line.match(/^#{2,3}\s+(.+?)\s*$/);
    return match?.[1] === heading;
  });
  if (start === -1) return '';

  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{2,3}\s+/.test(line)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

function parseMarkdownTable(markdown) {
  const lines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));
  if (lines.length < 3) return [];

  const headers = splitMarkdownRow(lines[0]).map((header) =>
    slugify(stripInlineMarkdown(header))
  );
  const rows = [];
  for (const line of lines.slice(2)) {
    const cells = splitMarkdownRow(line);
    if (cells.length === 0) continue;
    const row = {};
    for (const [index, header] of headers.entries()) {
      row[header] = cells[index]?.trim() ?? '';
    }
    rows.push({
      name: stripInlineMarkdown(row.parameter ?? row.name ?? ''),
      type: row.type ?? '',
      description: row.description ?? '',
    });
  }
  return rows.filter((row) => row.name);
}

function splitMarkdownRow(line) {
  const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  let escaped = false;
  for (const char of trimmed) {
    if (char === '|' && !escaped) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
    escaped = char === '\\' && !escaped;
    if (char !== '\\') escaped = false;
  }
  cells.push(current.trim());
  return cells;
}

function compactMarkdownText(markdown) {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('|') && !line.startsWith('```'))
    .slice(0, 6)
    .join(' ')
    .trim();
}

function extractCodeBlocks(markdown) {
  return [...markdown.matchAll(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g)].map(
    (match) => match[1].trim()
  );
}

async function readSkillDocs() {
  const skillsRoot = path.join(repoRoot, 'src/ax/skills');
  const files = (await readdir(skillsRoot))
    .filter((file) => file.endsWith('.md'))
    .sort();
  const docs = [];
  for (const file of files) {
    const rel = `src/ax/skills/${file}`;
    const body = await readFile(path.join(repoRoot, rel), 'utf8');
    docs.push({
      rel,
      title: parseMarkdownHeading(stripFrontmatter(body)) ?? file,
      headings: [...body.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1]),
    });
  }
  return docs;
}

async function readLanguageSkillCatalogs(languages) {
  const rootPackage = await readJson(path.join(repoRoot, 'package.json'));
  const rootVersion = String(rootPackage.version ?? '0.1.0');
  const out = {};
  for (const language of languages) {
    if (language.id === 'typescript') {
      const skillsRoot = path.join(repoRoot, 'src/ax/skills');
      const files = (await readdir(skillsRoot))
        .filter((file) => file.endsWith('.md'))
        .sort();
      out[language.id] = files.map((file) => {
        const rel = `src/ax/skills/${file}`;
        const abs = path.join(repoRoot, rel);
        return { abs, rel, typeScriptVersion: rootVersion };
      });
      continue;
    }

    const packageSkillsRoot = path.join(
      repoRoot,
      'packages',
      language.id,
      'skills'
    );
    const files = (await listFiles(packageSkillsRoot))
      .filter((file) => path.basename(file) === 'SKILL.md')
      .sort();
    out[language.id] = files.map((abs) => ({
      abs,
      rel: path.relative(repoRoot, abs).replaceAll(path.sep, '/'),
    }));
  }

  for (const [languageId, entries] of Object.entries(out)) {
    const skills = [];
    for (const entry of entries) {
      let content = await readFile(entry.abs, 'utf8');
      if (entry.typeScriptVersion) {
        content = content.replace(
          /^version:\s*["']?__VERSION__["']?/m,
          `version: "${entry.typeScriptVersion}"`
        );
      }
      const frontmatter = parseSkillFrontmatter(content);
      if (!frontmatter.name || !frontmatter.description) {
        throw new Error(`${entry.rel} is missing skill name or description`);
      }
      skills.push({
        name: frontmatter.name,
        description: frontmatter.description,
        version: frontmatter.version,
        content,
        source: entry.rel,
      });
    }
    skills.sort((left, right) =>
      skillSortName(languageId, left).localeCompare(
        skillSortName(languageId, right)
      )
    );
    out[languageId] = skills;
  }

  return out;
}

async function writeSkillInstallIndexes(languages, languageSkills) {
  for (const language of languages) {
    const skills = languageSkills[language.id] ?? [];
    if (skills.length === 0) {
      throw new Error(`No skills found for ${language.id}`);
    }
    const root = path.join(
      siteRoot,
      'static',
      language.id,
      '.well-known',
      'agent-skills'
    );
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });

    const entries = [];
    for (const skill of skills) {
      const skillDir = path.join(root, skill.name);
      await mkdir(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, 'SKILL.md');
      await writeFile(skillPath, ensureTrailingNewline(skill.content), 'utf8');
      const digest = sha256Digest(await readFile(skillPath));
      entries.push({
        name: skill.name,
        type: 'skill-md',
        description: skill.description,
        url: `${skill.name}/SKILL.md`,
        digest,
      });
    }

    await writeFile(
      path.join(root, 'index.json'),
      `${JSON.stringify({ $schema: skillDiscoverySchema, skills: entries }, null, 2)}\n`,
      'utf8'
    );
  }
}

async function readExamples(languages, exampleCatalog) {
  const byLanguage = {};
  for (const language of languages) {
    const rows = exampleCatalog.byLanguage[language.id] ?? [];
    byLanguage[language.id] = rows.map((example) => ({
      ...example,
      languageLabel: language.label,
      command: example.command,
      url: `${githubBlob}/${example.sourcePath}`,
    }));
  }
  return byLanguage;
}

async function readPackageInventories(languages) {
  const out = {};
  for (const language of languages) {
    if (language.id === 'typescript') continue;
    const packageRoot = path.join(repoRoot, 'packages', language.id);
    const apiManifest = await readJson(path.join(packageRoot, 'axir-api.json'));
    const capabilities = await readJson(
      path.join(packageRoot, 'axir-capabilities.json')
    );
    const coverage = await readJson(
      path.join(packageRoot, 'conformance-coverage.json')
    );
    out[language.id] = {
      apiManifest,
      capabilities,
      coverage,
      apiSections: apiManifest.sections ?? [],
    };
  }
  return out;
}

function apiRowsFor(language, subsystem, inventory) {
  if (language.apiKind === 'typedoc') {
    const keywords =
      language.apiSections?.[subsystem] ?? typedocKeywordFallback[subsystem];
    return inventory.typedocPages
      .filter((page) => matchesKeywords(page, keywords))
      .slice(0, 90)
      .map((page) => ({
        name: page.title,
        kind: kindFromTypedocRel(page.rel),
        form: page.title,
        description: page.description ?? typeDocFallbackDescription(page),
        source: page.definedIn ?? page.source,
        callSignatures: page.callSignatures,
        parameters: page.parameters,
        returns: page.returns,
        examples: page.examples,
        href: `/${language.id}/api/reference/${page.slug}/`,
      }));
  }

  const packageInventory = inventory.packages[language.id];
  const sectionNames = new Set(language.apiSections?.[subsystem] ?? []);
  const aliasNames = subsystemAliases[subsystem] ?? new Set();
  const sections = (packageInventory?.apiSections ?? []).filter(
    (section) =>
      sectionNames.has(section.title) || aliasNames.has(section.title)
  );

  return sections.flatMap((section) =>
    (section.symbols ?? []).map((symbol) => ({
      name: symbol.public_name,
      kind: symbol.kind ?? 'symbol',
      form: symbol.form ?? symbol.public_name,
      description: symbol.description ?? section.description ?? section.title,
      canonicalName: symbol.canonical_name,
      sectionTitle: section.title,
      returns: symbol.returns,
      importantOptions: symbol.important_options ?? [],
      parameters: symbol.parameters ?? [],
      methods: symbol.methods ?? [],
      examples: [
        ...(symbol.example ? [symbol.example] : []),
        ...(symbol.examples ?? []),
      ],
      notes: symbol.notes ?? [],
      href: `/${language.id}/api/reference/#${slugify(symbol.public_name)}`,
    }))
  );
}

function matchesKeywords(page, keywords) {
  const haystack = `${page.title} ${page.rel}`.toLowerCase();
  return keywords.some((keyword) => {
    const needle = keyword.toLowerCase();
    if (needle.length <= 2) {
      return (
        haystack.includes(`function.${needle}.md`) ||
        haystack.includes(` ${needle} `) ||
        page.title.toLowerCase() === needle
      );
    }
    return haystack.includes(needle);
  });
}

function typeDocFallbackDescription(page) {
  const kind = kindFromTypedocRel(page.rel);
  if (kind === 'function') {
    return `TypeScript function exported by \`@ax-llm/ax\`. See the call shape, arguments, and full reference below.`;
  }
  if (kind === 'class') {
    return `TypeScript class exported by \`@ax-llm/ax\`. See the constructor, methods, and full reference below.`;
  }
  if (kind === 'interface') {
    return `TypeScript interface exported by \`@ax-llm/ax\`. See the fields and full reference below.`;
  }
  return `TypeScript ${kind} exported by \`@ax-llm/ax\`. See the full reference for complete details.`;
}

function apiCards(rows, language, subsystem) {
  if (rows.length === 0) {
    return 'No API entries are currently mapped for this subsystem.';
  }

  const [coreRows, advancedRows] = partitionApiRows(rows, subsystem);
  const out = [
    '<section class="api-core-section">',
    '',
    '## Most Used',
    '',
    ...(coreRows.length > 0
      ? coreRows.map((row) => apiCard(row, language))
      : rows.slice(0, 8).map((row) => apiCard(row, language))),
    '',
    '</section>',
  ];

  const remaining =
    coreRows.length > 0 ? advancedRows : rows.slice(Math.min(rows.length, 8));
  if (remaining.length > 0) {
    out.push(
      '',
      '<details class="api-advanced-section">',
      '<summary>Advanced / internals / full reference</summary>',
      '',
      ...remaining.map((row) => apiCard(row, language)),
      '',
      '</details>'
    );
  }

  return out.join('\n\n');
}

function partitionApiRows(rows, subsystem) {
  const core = coreApiSymbols[subsystem] ?? new Set();
  const coreRows = [];
  const advancedRows = [];
  for (const row of rows) {
    if (isCoreApiRow(row, core)) {
      coreRows.push(row);
    } else {
      advancedRows.push(row);
    }
  }
  return [coreRows, advancedRows];
}

function isCoreApiRow(row, core) {
  const names = [
    row.name,
    row.canonicalName,
    String(row.name ?? '')
      .split('.')
      .pop(),
    String(row.name ?? '').replace(/^axllm(?:::|\.)/, ''),
  ].map((name) => String(name ?? '').toLowerCase());
  return [...core].some((symbol) => {
    const normalized = symbol.toLowerCase();
    return names.some(
      (name) => name === normalized || name.endsWith(`.${normalized}`)
    );
  });
}

function apiCard(row, language) {
  const out = [
    `<section class="api-card" id="${slugify(row.name)}">`,
    '',
    `## \`${row.name}\``,
    '',
    row.description ? rewriteTypeDocLinks(row.description) : '',
    '',
    `| Field | Value |`,
    `| --- | --- |`,
    `| Kind | \`${escapePipes(row.kind)}\` |`,
  ];

  if (row.canonicalName) {
    out.push(`| Ax concept | \`${escapePipes(row.canonicalName)}\` |`);
  }
  if (row.sectionTitle) {
    out.push(`| API section | ${escapePipes(row.sectionTitle)} |`);
  }
  if (row.form) {
    out.push(`| Form | \`${escapePipes(row.form)}\` |`);
  }
  if (row.returns) {
    out.push(`| Returns | ${escapePipes(rewriteTypeDocLinks(row.returns))} |`);
  }
  if (row.source) {
    out.push(`| Source | ${sourceCell(row.source)} |`);
  }

  const signatures = normalizedExamples(row.callSignatures);
  if (signatures.length > 0) {
    out.push('', '### Call Shape', '');
    for (const signature of signatures.slice(0, 3)) {
      out.push(codeFence(language.fence, signature));
    }
  }

  const parameters = normalizedParameters(row.parameters);
  if (parameters.length > 0) {
    out.push('', '### Arguments And Options', '');
    out.push('| Name | Type | Description |');
    out.push('| --- | --- | --- |');
    for (const parameter of parameters.slice(0, 12)) {
      out.push(
        `| \`${escapePipes(parameter.name)}\` | ${escapePipes(rewriteTypeDocLinks(parameter.type ?? ''))} | ${escapePipes(rewriteTypeDocLinks(parameter.description ?? ''))} |`
      );
    }
  } else if (row.importantOptions?.length > 0) {
    out.push('', '### Important Options', '');
    out.push(
      ...row.importantOptions.map((option) => `- \`${escapePipes(option)}\``)
    );
  }

  if (row.methods?.length > 0) {
    out.push('', '### Methods', '');
    out.push(
      ...row.methods
        .slice(0, 12)
        .map((method) =>
          typeof method === 'string'
            ? `- \`${method}\``
            : `- \`${method.name ?? method.form ?? 'method'}\`${
                method.description ? ` - ${method.description}` : ''
              }`
        )
    );
  }

  const examples = normalizedExamples(row.examples);
  if (examples.length > 0) {
    out.push('', '### Examples', '');
    for (const example of examples.slice(0, 2)) {
      out.push(codeFence(language.fence, example));
    }
  }

  if (row.notes?.length > 0) {
    out.push('', '### Notes', '');
    out.push(...row.notes.map((note) => `- ${note}`));
  }

  out.push('', `[Full reference](${row.href})`, '', '</section>');
  return out.filter((line) => line !== undefined).join('\n');
}

function apiReferenceLink(language, subsystem) {
  return `[Open the full ${language.label} reference](/${language.id}/api/reference/). This page highlights the ${subsystem} symbols most relevant to everyday use.`;
}

function snippetBlock(language, key, fallbackKey) {
  const snippet = snippetDetails(language, key, fallbackKey);
  if (!snippet.code) return '';
  return [snippetMeta(snippet), codeFence(snippet.fence, snippet.code)]
    .filter(Boolean)
    .join('\n\n');
}

function snippetCode(language, key, fallbackKey) {
  return snippetDetails(language, key, fallbackKey).code;
}

function snippetDetails(language, key, fallbackKey) {
  const resolved = resolveSnippetValue(language, key, fallbackKey);
  if (!resolved) {
    return {
      code: '',
      fence: language.fence,
      verified: false,
      illustrative: false,
      requiresCredentials: false,
      notes: [],
    };
  }
  return normalizeSnippet(language, resolved.value, resolved.origin);
}

function resolveSnippetValue(language, key, fallbackKey) {
  const groupValue = getPath(language.snippetGroups, key);
  if (groupValue !== undefined)
    return { value: groupValue, origin: 'language' };

  const snippetValue = getPath(language.snippets, key);
  if (snippetValue !== undefined) {
    return { value: snippetValue, origin: 'language' };
  }

  const builtIn = builtInSnippet(language.id, key);
  if (builtIn !== undefined) return { value: builtIn, origin: 'built-in' };

  if (fallbackKey) {
    const fallback = getPath(language.snippets, fallbackKey);
    if (fallback !== undefined) return { value: fallback, origin: 'fallback' };
  }
  return undefined;
}

function normalizeSnippet(language, value, origin) {
  const isObject = value && typeof value === 'object' && !Array.isArray(value);
  const code = lines(
    isObject ? (value.code ?? value.lines ?? value.snippet ?? '') : value
  ).trim();
  const sourcePath = isObject ? value.sourcePath : undefined;
  const notes = normalizedStringList(isObject ? value.notes : undefined);
  const generatedEquivalent =
    language.id !== 'typescript' && !sourcePath && origin !== 'fallback';

  return {
    code,
    fence: (isObject && value.fence) || language.fence,
    verified: Boolean(isObject && value.verified),
    illustrative:
      Boolean(isObject && value.illustrative) || generatedEquivalent,
    sourcePath,
    requiresCredentials: Boolean(isObject && value.requiresCredentials),
    notes:
      notes.length > 0
        ? notes
        : generatedEquivalent
          ? [
              'Generated-package equivalent. Prefer checked-in package examples for copy/paste runnable code.',
            ]
          : [],
  };
}

function snippetMeta(snippet) {
  const badges = [];
  if (snippet.verified) {
    badges.push(
      '<span class="snippet-badge snippet-badge-verified">Verified</span>'
    );
  } else if (snippet.illustrative) {
    badges.push(
      '<span class="snippet-badge snippet-badge-illustrative">Illustrative</span>'
    );
  }
  if (snippet.requiresCredentials) {
    badges.push('<span class="snippet-badge">Needs credentials</span>');
  }
  if (snippet.sourcePath) {
    badges.push(
      `<a class="snippet-badge" href="${githubBlob}/${escapeHTML(snippet.sourcePath)}">Source</a>`
    );
  }
  const notes = snippet.notes
    .map((note) => `<span class="snippet-note">${escapeHTML(note)}</span>`)
    .join('');
  if (badges.length === 0 && !notes) return '';
  const status = snippet.verified
    ? 'verified'
    : snippet.illustrative
      ? 'illustrative'
      : 'reference';
  return `<div class="snippet-meta" data-snippet-label data-snippet-status="${status}">${badges.join('')}${notes}</div>`;
}

function normalizedStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return [String(value)].filter(Boolean);
}

function getPath(object, key) {
  if (!object) return undefined;
  return key.split('.').reduce((current, part) => current?.[part], object);
}

function builtInSnippet(languageId, key) {
  const ts = {
    'signatures.string': [
      "import { ax, s } from '@ax-llm/ax';",
      '',
      'const sig = s(\'emailText:string -> priority:class "high, normal, low", rationale:string\');',
      'const classify = ax(sig);',
    ],
    'signatures.fluent': [
      "import { f } from '@ax-llm/ax';",
      '',
      'const sig = f()',
      "  .description('Classify an inbound support email')",
      "  .input('emailText', f.string('Raw customer email').cache())",
      "  .input('accountTier', f.class(['free', 'pro', 'enterprise']).optional())",
      "  .output('priority', f.class(['high', 'normal', 'low']))",
      "  .output('reasoning', f.string('Private working notes').internal())",
      "  .output('reply', f.string('Customer-facing reply'))",
      '  .build();',
    ],
    'signatures.validation': [
      "import { f } from '@ax-llm/ax';",
      '',
      'const sig = f()',
      "  .input('formText', f.string('Raw form submission'))",
      "  .output('email', f.string('Contact email').email())",
      "  .output('score', f.number('Risk score').min(0).max(100))",
      "  .output('tags', f.string('Tag').min(2).max(30).array())",
      '  .build();',
    ],
    'signatures.hybrid': [
      "import { f, s } from '@ax-llm/ax';",
      '',
      "const sig = s('question:string -> answer:string')",
      "  .appendInputField('context', f.string('Stable reference context').cache().optional())",
      "  .appendOutputField('confidence', f.number('0..1 confidence').min(0).max(1));",
    ],
    'signatures.standardSchema': [
      "import { z } from 'zod';",
      "import { f } from '@ax-llm/ax';",
      '',
      'const sig = f()',
      '  .input(',
      '    z.object({',
      "      context: z.string().describe('Reference context'),",
      "      question: z.string().min(1).describe('User question'),",
      '    }),',
      '    { fields: { context: { cache: true } } }',
      '  )',
      '  .output(',
      '    z.object({',
      "      reasoning: z.string().describe('Private reasoning'),",
      "      answer: z.string().min(1).describe('Final answer'),",
      "      priority: z.enum(['low', 'normal', 'high']),",
      '    }),',
      '    { fields: { reasoning: { internal: true } } }',
      '  )',
      '  .build();',
    ],
    'signatures.toolSchema': [
      "import { z } from 'zod';",
      "import { fn } from '@ax-llm/ax';",
      '',
      "const lookupProduct = fn('lookupProduct')",
      "  .description('Look up product inventory')",
      '  .arg(z.object({ productName: z.string().min(1), includeSpecs: z.boolean().optional() }))',
      '  .returns(z.object({ price: z.number(), inStock: z.boolean(), rating: z.number().min(1).max(5) }))',
      '  .handler(async ({ productName }) => ({ price: 79.99, inStock: true, rating: 4.3 }))',
      '  .build();',
    ],
    'ax.tools': [
      "import { ai, ax, f, fn } from '@ax-llm/ax';",
      '',
      "const searchDocs = fn('searchDocs')",
      "  .namespace('kb')",
      "  .description('Search product documentation')",
      "  .arg('query', f.string('Search query'))",
      "  .returns(f.string('Matching snippets').array())",
      "  .handler(async ({ query }) => ['hit for ' + query])",
      '  .build();',
      '',
      "const answer = ax('question:string -> answer:string');",
      'await answer.forward(llm, { question: "How do refunds work?" }, { functions: [searchDocs] });',
    ],
    'ax.streaming': [
      "const write = ax('topic:string -> article:string');",
      "const stream = write.streamingForward(llm, { topic: 'runtime agents' });",
      '',
      'for await (const chunk of stream) {',
      '  if (chunk.delta.article) process.stdout.write(chunk.delta.article);',
      '}',
    ],
    'agents.minimal': [
      "import { agent, ai } from '@ax-llm/ax';",
      '',
      "const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });",
      "const assistant = agent('question:string -> answer:string', { contextFields: [] });",
      "const out = await assistant.forward(llm, { question: 'What is RLM?' });",
      'console.log(out.answer);',
    ],
    'agents.tools': [
      "import { agent, f, fn } from '@ax-llm/ax';",
      '',
      "const findPolicy = fn('findPolicy')",
      "  .namespace('kb')",
      "  .description('Find policy snippets')",
      "  .arg('topic', f.string('Policy topic'))",
      "  .returns(f.string('Snippets').array())",
      "  .handler(async ({ topic }) => ['policy: ' + topic])",
      '  .build();',
      '',
      "const support = agent('message:string -> reply:string', {",
      '  functions: [findPolicy],',
      '  functionDiscovery: true,',
      '  contextFields: [],',
      '});',
    ],
    'agents.discovery': [
      "const research = agent('task:string -> answer:string', {",
      '  functionDiscovery: true,',
      '  functions: [',
      "    { namespace: 'kb', title: 'Knowledge Base', selectionCriteria: 'Use for docs lookup.', functions: [findPolicy] },",
      "    { namespace: 'team', title: 'Specialist Agents', functions: [writer.getFunction()] },",
      '  ],',
      '  contextFields: [],',
      '});',
      '',
      "// Actor code should call: await discover(['kb']) before using large/unknown modules.",
    ],
    'agents.memory': [
      "const assistant = agent('task:string -> answer:string', {",
      '  contextFields: [],',
      '  onMemoriesSearch: async (searches, alreadyLoaded) => {',
      '    const skip = new Set(alreadyLoaded.map((m) => m.id));',
      '    return searchMemoryStore(searches).filter((m) => !skip.has(m.id));',
      '  },',
      '  onSkillsSearch: async (searches) => resolveSkillGuides(searches),',
      '});',
      '',
      "// Actor code can use: await recall(['user preferences']);",
      "// Actor code can use: await discover({ skills: ['release-checklist'] });",
    ],
    'agents.contextPolicy': [
      "const longTaskAgent = agent('repo:string, request:string -> answer:string', {",
      "  contextFields: ['repo'],",
      "  contextPolicy: { preset: 'checkpointed', budget: 'balanced' },",
      '  maxRuntimeChars: 3000,',
      "  executorModelPolicy: [{ model: 'gpt-5.4', aboveErrorTurns: 2, namespaces: ['kb', 'db'] }],",
      '});',
    ],
    'agents.optimize': [
      'const tasks = [',
      '  {',
      "    input: { query: 'Send an email to Jim saying good morning.' },",
      "    criteria: 'Use the email tool and send the message to Jim.',",
      "    expectedActions: ['email.sendEmail'],",
      '  },',
      '];',
      '',
      'const result = await assistant.optimize(tasks, { bootstrap: true, maxMetricCalls: 12 });',
      'assistant.applyOptimization(result.optimizedProgram!);',
    ],
    'ai.openai': [
      "import { AxAIOpenAIModel, ai } from '@ax-llm/ax';",
      '',
      'const openai = ai({',
      "  name: 'openai',",
      '  apiKey: process.env.OPENAI_APIKEY!,',
      '  config: { model: AxAIOpenAIModel.GPT4OMini },',
      '});',
    ],
    'ai.responses': [
      'const responses = ai({',
      "  name: 'openai-responses',",
      '  apiKey: process.env.OPENAI_APIKEY!,',
      "  config: { model: 'gpt-4.1-mini' },",
      '});',
    ],
    'ai.claude': [
      "import { AxAIAnthropicModel, ai } from '@ax-llm/ax';",
      '',
      'const claude = ai({',
      "  name: 'anthropic',",
      '  apiKey: process.env.ANTHROPIC_APIKEY!,',
      '  config: { model: AxAIAnthropicModel.Claude48Opus },',
      '});',
    ],
    'ai.gemini': [
      "import { AxAIGoogleGeminiModel, ai } from '@ax-llm/ax';",
      '',
      'const gemini = ai({',
      "  name: 'google-gemini',",
      '  apiKey: process.env.GOOGLE_APIKEY!,',
      '  config: { model: AxAIGoogleGeminiModel.Gemini25Flash },',
      '});',
    ],
    'ai.compatible': [
      'const compatible = ai({',
      "  name: 'openai',",
      '  apiKey: process.env.PROVIDER_API_KEY!,',
      "  apiURL: 'https://provider.example/v1',",
      "  config: { model: 'provider/model-name' },",
      '});',
    ],
    'ai.embeddings': [
      'const { embeddings } = await openai.embed({',
      "  texts: ['typed LLM programs', 'runtime agents'],",
      "  embedModel: 'text-embedding-3-small',",
      '});',
    ],
    'ai.audio': [
      'const transcript = await openai.transcribe({',
      "  audio: { data: base64Wav, format: 'wav' },",
      "  model: 'gpt-4o-mini-transcribe',",
      "  language: 'en',",
      '});',
      '',
      "const speech = await openai.speak({ text: transcript.text, model: 'gpt-4o-mini-tts', voice: 'alloy' });",
    ],
    'ai.thinking': [
      'const res = await claude.chat(',
      "  { chatPrompt: [{ role: 'user', content: 'Review this design.' }] },",
      "  { thinkingTokenBudget: 'medium', showThoughts: true }",
      ');',
      'console.log(res.results[0]?.thought);',
    ],
    'ai.catalog': [
      "import { axGetSupportedAIModels } from '@ax-llm/ax';",
      '',
      "const textModels = axGetSupportedAIModels({ type: 'text' });",
      "const audioModels = axGetSupportedAIModels({ type: 'audio' });",
      'console.log(textModels[0]?.models[0]?.promptTokenCostPer1M);',
    ],
    'optimize.axgen': [
      'const classifier = ax(\'emailText:string -> priority:class "high, normal, low"\');',
      'const metric = ({ prediction, example }) =>',
      '  prediction.priority === example.priority ? 1 : 0;',
      '',
      'const result = await optimize(classifier, train, metric, {',
      '  studentAI,',
      '  teacherAI,',
      '  validationExamples,',
      '  maxMetricCalls: 120,',
      '});',
      'classifier.applyOptimization(result.optimizedProgram!);',
    ],
    'optimize.flow': [
      'const wf = flow<{ emailText: string }>()',
      "  .n('classifier', 'emailText:string -> priority:class \"high, normal, low\"')",
      "  .n('rationale', 'emailText:string, priority:string -> rationale:string')",
      "  .e('classifier', (s) => ({ emailText: s.emailText }))",
      "  .e('rationale', (s) => ({ emailText: s.emailText, priority: s.classifierResult.priority }))",
      '  .r((s) => ({ priority: s.classifierResult.priority, rationale: s.rationaleResult.rationale }));',
      '',
      'const result = await optimize(wf, train, multiObjectiveMetric, { studentAI, teacherAI });',
    ],
    'optimize.agent': [
      'const result = await supportAgent.optimize(tasks, {',
      '  judgeAI,',
      "  judgeOptions: { description: 'Prefer correct tool use over polished wording.' },",
      '  bootstrap: true,',
      '  maxMetricCalls: 24,',
      '});',
      'supportAgent.applyOptimization(result.optimizedProgram!);',
    ],
    'optimize.artifact': [
      'import { axDeserializeOptimizedProgram, axSerializeOptimizedProgram } from "@ax-llm/ax";',
      '',
      'const saved = axSerializeOptimizedProgram(result.optimizedProgram!);',
      'const restored = axDeserializeOptimizedProgram(saved);',
      'program.applyOptimization(restored);',
    ],
  };

  if (languageId === 'typescript') return ts[key];

  const generated = generatedPackageSnippets(languageId);
  return generated[key] ?? generated.default;
}

function generatedPackageSnippets(languageId) {
  const commentPrefix = languageId === 'python' ? '#' : '//';
  const comments = (values) =>
    values.map((value) => `${commentPrefix} ${value}`);
  const snippets = {
    python: {
      default: [
        'from axllm import ax',
        '',
        'program = ax("question:string -> answer:string")',
      ],
      'signatures.string': [
        'from axllm import s',
        '',
        'sig = s("question:string -> answer:string")',
        'schema = sig.to_json_schema("outputs")',
      ],
      'ai.openai': [
        'from axllm import OpenAICompatibleClient, ax',
        '',
        'client = OpenAICompatibleClient(api_key=api_key, model="gpt-4.1-mini")',
        'program = ax("question:string -> answer:string")',
        'out = program.forward(client, {"question": "What is Ax?"})',
      ],
      'agents.minimal': [
        'from axllm import agent',
        '',
        'assistant = agent("question:string -> answer:string", {"contextFields": []})',
        'out = assistant.forward(client, {"question": "Capital of France?"})',
      ],
      'optimize.axgen': [
        'from axllm import AxGEPA',
        '',
        'gepa = AxGEPA({"maxMetricCalls": 40})',
        'artifact = gepa.optimize({"program": program, "train": train}, evaluator)',
      ],
      'mcp.scripted': [
        'from axllm import AxMCPClient',
        'from axllm.mcp import AxMCPScriptedTransport',
        '',
        'client = AxMCPClient(AxMCPScriptedTransport(responses))',
        'client.init()',
        'result = client.to_function()[0].call({"text": "hello"})',
      ],
      'mcp.stdio': [
        'from axllm import AxMCPClient, AxMCPStdioTransport',
        '',
        'transport = AxMCPStdioTransport("npx", ["-y", "@modelcontextprotocol/server-memory"])',
        'client = AxMCPClient(transport)',
        'client.init()',
      ],
      'mcp.http': [
        'from axllm import AxMCPClient, AxMCPStreamableHTTPTransport',
        '',
        'transport = AxMCPStreamableHTTPTransport(',
        '    "https://mcp.example.com/mcp",',
        '    {"authorization": f"Bearer {access_token}"},',
        ')',
        'client = AxMCPClient(transport)',
        'client.init()',
      ],
      'mcp.capabilities': [
        'tools = client.to_function()',
        'print([tool.name for tool in tools])',
        'print(client.server_capabilities)',
      ],
      'mcp.overrides': [
        'client = AxMCPClient(transport, {',
        '    "functionOverrides": [',
        '        {"name": "search_documents", "updates": {"name": "find_docs"}}',
        '    ]',
        '})',
      ],
      'mcp.axTools': [
        'client = AxMCPClient(transport)',
        'client.init()',
        'program = ax("question:string -> answer:string")',
        'out = program.forward(llm, {"question": "Search memory"}, {"functions": client.to_function()})',
      ],
      'mcp.agentFlat': [
        'client = AxMCPClient(transport)',
        'client.init()',
        'assistant = agent("request:string -> response:string", {',
        '    "functions": client.to_function(),',
        '    "functionDiscovery": True,',
        '    "contextFields": [],',
        '})',
      ],
      'mcp.agentGrouped': [
        'assistant = agent("request:string -> response:string", {',
        '    "functions": [{',
        '        "namespace": "memory",',
        '        "title": "Memory MCP",',
        '        "selectionCriteria": "Use for persistent memory lookup.",',
        '        "functions": client.to_function(),',
        '    }],',
        '    "functionDiscovery": True,',
        '    "contextFields": [],',
        '})',
      ],
    },
    java: {
      default: [
        'import dev.axllm.ax.Ax;',
        '',
        'AxGen qa = Ax.ax("question:string -> answer:string");',
      ],
      'signatures.string': [
        'AxSignature sig = Ax.s("question:string -> answer:string");',
        'Map<String, Object> schema = sig.toJsonSchema("outputs");',
      ],
      'ai.openai': [
        'AxAIClient client = Ax.openAICompatible(Map.of(',
        '  "api_key", apiKey,',
        '  "model", "gpt-4.1-mini"',
        '));',
      ],
      'agents.minimal': [
        'AxAgent assistant = Ax.agent(',
        '  "question:string -> answer:string",',
        '  Map.of("contextFields", List.of())',
        ');',
      ],
      'optimize.axgen': [
        'AxGEPA gepa = new AxGEPA(Map.of("maxMetricCalls", 40));',
        'Map<String, Object> artifact = gepa.optimize(request, evaluator);',
      ],
      'mcp.scripted': [
        'AxMCPScriptedTransport transport = new AxMCPScriptedTransport(responses);',
        'AxMCPClient client = new AxMCPClient(transport);',
        'client.init();',
        'Object result = client.toFunction().get(0).call(Map.of("text", "hello"));',
      ],
      'mcp.stdio': [
        'AxMCPStdioTransport transport = new AxMCPStdioTransport(',
        '  "npx",',
        '  List.of("-y", "@modelcontextprotocol/server-memory")',
        ');',
        'AxMCPClient client = new AxMCPClient(transport);',
        'client.init();',
      ],
      'mcp.http': [
        'AxMCPStreamableHTTPTransport transport = new AxMCPStreamableHTTPTransport(',
        '  "https://mcp.example.com/mcp",',
        '  Map.of("authorization", "Bearer " + accessToken)',
        ');',
        'AxMCPClient client = new AxMCPClient(transport);',
        'client.init();',
      ],
      'mcp.capabilities': [
        'System.out.println(client.getServerCapabilities());',
        'System.out.println(client.toFunction().size());',
      ],
      'mcp.overrides': [
        'AxMCPClient client = new AxMCPClient(transport, Map.of(',
        '  "functionOverrides", List.of(Map.of(',
        '    "name", "search_documents",',
        '    "updates", Map.of("name", "findDocs")',
        '  ))',
        '));',
      ],
      'mcp.axTools': [
        'AxMCPClient client = new AxMCPClient(transport);',
        'client.init();',
        'AxGen answer = Ax.ax("question:string -> answer:string");',
        'answer.forward(llm, Map.of("question", "Search memory"), Map.of("functions", client.toFunction()));',
      ],
      'mcp.agentFlat': [
        'AxMCPClient client = new AxMCPClient(transport);',
        'client.init();',
        'AxAgent assistant = Ax.agent("request:string -> response:string", Map.of(',
        '  "functions", client.toFunction(),',
        '  "functionDiscovery", true,',
        '  "contextFields", List.of()',
        '));',
      ],
      'mcp.agentGrouped': [
        'AxAgent assistant = Ax.agent("request:string -> response:string", Map.of(',
        '  "functions", List.of(Map.of(',
        '    "namespace", "memory",',
        '    "title", "Memory MCP",',
        '    "selectionCriteria", "Use for persistent memory lookup.",',
        '    "functions", client.toFunction()',
        '  )),',
        '  "functionDiscovery", true,',
        '  "contextFields", List.of()',
        '));',
      ],
    },
    cpp: {
      default: [
        '#include <axllm/axllm.hpp>',
        '',
        'auto qa = axllm::ax("question:string -> answer:string");',
      ],
      'signatures.string': [
        'auto sig = axllm::s("question:string -> answer:string");',
        'auto schema = sig.to_json_schema("outputs");',
      ],
      'ai.openai': [
        'auto client = axllm::OpenAICompatibleClient({',
        '  {"api_key", api_key},',
        '  {"model", "gpt-4.1-mini"},',
        '});',
      ],
      'agents.minimal': [
        'auto assistant = axllm::agent(',
        '  "question:string -> answer:string",',
        '  axllm::object({{"contextFields", axllm::array()}})',
        ');',
      ],
      'optimize.axgen': [
        'axllm::AxGEPA gepa(axllm::object({{"maxMetricCalls", 40}}));',
        'auto artifact = gepa.optimize(request, &evaluator);',
      ],
      'mcp.scripted': [
        'auto transport = std::make_shared<axllm::AxMCPScriptedTransport>(responses);',
        'axllm::AxMCPClient client(transport);',
        'client.init();',
        'auto result = client.to_function().front().handler(axllm::object({{"text", "hello"}}));',
      ],
      'mcp.stdio': [
        'auto transport = std::make_shared<axllm::AxMCPStdioTransport>(',
        '  "npx",',
        '  std::vector<std::string>{"-y", "@modelcontextprotocol/server-memory"}',
        ');',
        'axllm::AxMCPClient client(transport);',
        'client.init();',
      ],
      'mcp.http': [
        'auto transport = std::make_shared<axllm::AxMCPStreamableHTTPTransport>(',
        '  "https://mcp.example.com/mcp",',
        '  axllm::object({{"authorization", "Bearer " + accessToken}})',
        ');',
        'axllm::AxMCPClient client(transport);',
        'client.init();',
      ],
      'mcp.capabilities': [
        'auto tools = client.to_function();',
        'std::cout << "mcp tools: " << tools.size() << "\\n";',
      ],
      'mcp.overrides': [
        'axllm::AxMCPClient client(transport, axllm::object({',
        '  {"functionOverrides", axllm::array({',
        '    axllm::object({{"name", "search_documents"}, {"updates", axllm::object({{"name", "findDocs"}})}})',
        '  })}',
        '}));',
      ],
      'mcp.axTools': [
        'axllm::AxMCPClient client(transport);',
        'client.init();',
        'auto answer = axllm::ax("question:string -> answer:string");',
        'auto tools = client.to_function();',
      ],
      'mcp.agentFlat': [
        'axllm::AxMCPClient client(transport);',
        'client.init();',
        'auto assistant = axllm::agent("request:string -> response:string", axllm::object({',
        '  {"functions", client.to_function()},',
        '  {"functionDiscovery", true},',
        '  {"contextFields", axllm::array({})}',
        '}));',
      ],
      'mcp.agentGrouped': [
        'auto assistant = axllm::agent("request:string -> response:string", axllm::object({',
        '  {"functions", axllm::array({axllm::object({',
        '    {"namespace", "memory"},',
        '    {"title", "Memory MCP"},',
        '    {"selectionCriteria", "Use for persistent memory lookup."},',
        '    {"functions", client.to_function()}',
        '  })})},',
        '  {"functionDiscovery", true},',
        '  {"contextFields", axllm::array({})}',
        '}));',
      ],
    },
    go: {
      default: [
        'import ax "github.com/ax-llm/ax/packages/go"',
        '',
        'program := ax.NewAx("question:string -> answer:string", nil)',
      ],
      'signatures.string': [
        'sig := ax.NewSignature("question:string -> answer:string")',
        'schema := sig.ToJSONSchema(nil)',
      ],
      'ai.openai': [
        'client := ax.NewOpenAICompatibleClient(map[string]ax.Value{',
        '  "api_key": apiKey,',
        '  "model": "gpt-4.1-mini",',
        '})',
        'program := ax.NewAx("question:string -> answer:string", nil)',
        'out, err := program.Forward(ctx, client, map[string]ax.Value{"question": "What is Ax?"}, nil)',
      ],
      'agents.minimal': [
        'assistant := ax.NewAgent(',
        '  "question:string -> answer:string",',
        '  map[string]ax.Value{"contextFields": ax.Array()},',
        ')',
      ],
      'optimize.axgen': [
        'gepa := ax.NewAxGEPA(map[string]ax.Value{"maxMetricCalls": 40})',
        'artifact, err := gepa.Optimize(request, evaluator)',
      ],
      'mcp.scripted': [
        'transport := ax.NewAxMCPScriptedTransport(responses)',
        'client := ax.NewAxMCPClient(transport, nil)',
        'if err := client.Init(); err != nil { panic(err) }',
        'result := client.ToFunction()[0].Call(map[string]ax.Value{"text": "hello"})',
      ],
      'mcp.stdio': [
        'transport, err := ax.NewAxMCPStdioTransport(',
        '  "npx",',
        '  []string{"-y", "@modelcontextprotocol/server-memory"},',
        ')',
        'if err != nil { panic(err) }',
        'client := ax.NewAxMCPClient(transport, nil)',
        'if err := client.Init(); err != nil { panic(err) }',
      ],
      'mcp.http': [
        'transport, err := ax.NewAxMCPStreamableHTTPTransport(',
        '  "https://mcp.example.com/mcp",',
        '  map[string]ax.Value{"authorization": "Bearer " + accessToken},',
        ')',
        'if err != nil { panic(err) }',
        'client := ax.NewAxMCPClient(transport, nil)',
        'if err := client.Init(); err != nil { panic(err) }',
      ],
      'mcp.capabilities': [
        'fmt.Println(client.Tools())',
        'fmt.Println(len(client.ToFunction()))',
      ],
      'mcp.overrides': [
        'client := ax.NewAxMCPClient(transport, map[string]ax.Value{',
        '  "functionOverrides": []ax.Value{map[string]ax.Value{',
        '    "name": "search_documents",',
        '    "updates": map[string]ax.Value{"name": "findDocs"},',
        '  }},',
        '})',
      ],
      'mcp.axTools': [
        'client := ax.NewAxMCPClient(transport, nil)',
        'if err := client.Init(); err != nil { panic(err) }',
        'answer := ax.NewAx("question:string -> answer:string", nil)',
        'tools := client.ToFunction()',
        '_ = tools',
      ],
      'mcp.agentFlat': [
        'client := ax.NewAxMCPClient(transport, nil)',
        'if err := client.Init(); err != nil { panic(err) }',
        'assistant := ax.NewAgent("request:string -> response:string", map[string]ax.Value{',
        '  "functions": client.ToFunction(),',
        '  "functionDiscovery": true,',
        '  "contextFields": []ax.Value{},',
        '})',
      ],
      'mcp.agentGrouped': [
        'assistant := ax.NewAgent("request:string -> response:string", map[string]ax.Value{',
        '  "functions": []ax.Value{map[string]ax.Value{',
        '    "namespace": "memory",',
        '    "title": "Memory MCP",',
        '    "selectionCriteria": "Use for persistent memory lookup.",',
        '    "functions": client.ToFunction(),',
        '  }},',
        '  "functionDiscovery": true,',
        '  "contextFields": []ax.Value{},',
        '})',
      ],
    },
    rust: {
      default: [
        'use axllm::{ax, AxResult};',
        '',
        'let mut program = ax("question:string -> answer:string")?;',
      ],
      'signatures.string': [
        'use axllm::{s, AxResult};',
        '',
        'let sig = s("question:string -> answer:string")?;',
        'let schema = sig.to_json_schema("outputs");',
      ],
      'ai.openai': [
        'use axllm::{ax, OpenAICompatibleClient};',
        '',
        'let mut client = OpenAICompatibleClient::new(api_key, "gpt-4.1-mini");',
        'let mut program = ax("question:string -> answer:string")?;',
        'let output = program.forward(&mut client, serde_json::json!({"question": "What is Ax?"}))?;',
      ],
      'agents.minimal': [
        'use axllm::agent;',
        '',
        'let mut assistant = agent("question:string -> answer:string")?;',
      ],
      'optimize.axgen': [
        'let mut gepa = axllm::AxGEPA::new(serde_json::json!({"maxMetricCalls": 40}));',
        'let artifact = gepa.optimize(request, evaluator)?;',
      ],
      'mcp.scripted': [
        'use axllm::{mcp::AxMCPScriptedTransport, AxMCPClient, AxResult};',
        'use serde_json::json;',
        '',
        'let mut client = AxMCPClient::new(Box::new(AxMCPScriptedTransport::new(responses)), json!({}));',
        'client.init()?;',
        'let result = client.to_function()[0].call(json!({"text": "hello"}))?;',
      ],
      'mcp.stdio': [
        'use axllm::{AxMCPClient, AxMCPStdioTransport, AxResult};',
        'use serde_json::json;',
        '',
        'let transport = AxMCPStdioTransport::new("npx", vec!["-y", "@modelcontextprotocol/server-memory"])?;',
        'let mut client = AxMCPClient::new(Box::new(transport), json!({}));',
        'client.init()?;',
      ],
      'mcp.http': [
        'use axllm::{AxMCPClient, AxMCPStreamableHTTPTransport, AxResult};',
        'use serde_json::json;',
        '',
        'let transport = AxMCPStreamableHTTPTransport::new(',
        '  "https://mcp.example.com/mcp",',
        '  json!({"authorization": format!("Bearer {}", access_token)}),',
        ')?;',
        'let mut client = AxMCPClient::new(Box::new(transport), json!({}));',
        'client.init()?;',
      ],
      'mcp.capabilities': [
        'let tools = client.to_function();',
        'println!("mcp tools: {}", tools.len());',
      ],
      'mcp.overrides': [
        'let mut client = AxMCPClient::new(',
        '  Box::new(transport),',
        '  json!({"functionOverrides":[{"name":"search_documents","updates":{"name":"find_docs"}}]}),',
        ');',
      ],
      'mcp.axTools': [
        'let mut client = AxMCPClient::new(Box::new(transport), json!({}));',
        'client.init()?;',
        'let mut answer = axllm::ax("question:string -> answer:string")?;',
        'let tools = client.to_function();',
      ],
      'mcp.agentFlat': [
        'let mut client = AxMCPClient::new(Box::new(transport), json!({}));',
        'client.init()?;',
        'let tools = client.to_function();',
        'let mut assistant = axllm::agent("request:string -> response:string")?;',
        '// Use the generated package function surface to attach `tools` where supported.',
      ],
      'mcp.agentGrouped': [
        'let memory_tools = client.to_function();',
        'let mut assistant = axllm::agent("request:string -> response:string")?;',
        '// Group MCP tools under a namespace in the generated package agent config when using discovery.',
      ],
    },
  };

  const base = snippets[languageId] ?? snippets.python;
  return {
    ...base,
    'signatures.fluent': base['signatures.string'],
    'signatures.validation': base['signatures.string'],
    'signatures.hybrid': base['signatures.string'],
    'ax.tools': base.default,
    'ax.streaming': base.default,
    'agents.tools': base['agents.minimal'],
    'agents.discovery': base['agents.minimal'],
    'agents.memory': base['agents.minimal'],
    'agents.contextPolicy': base['agents.minimal'],
    'agents.optimize': base['agents.minimal'],
    'mcp.oauth':
      base['mcp.oauth'] ??
      comments([
        'Remote MCP OAuth options are part of the generated AxMCPStreamableHTTPTransport surface.',
        'Use the package API reference for this language when wiring client credentials, redirects, token storage, and SSRF protection.',
      ]),
    'ai.responses': comments([
      'See the internal generated-package fixture for OpenAI Responses audio mapping.',
      'It verifies request/response normalization outside the public examples catalog.',
    ]),
    'ai.claude': comments([
      'Native Claude/Gemini provider constructors live in the TypeScript reference package.',
      'Generated packages use the AxIR-supported provider surface for this language.',
    ]),
    'ai.gemini': comments([
      'Realtime Gemini/Grok event folding is covered by the generated package examples.',
      'Run `npm run example -- list` to find the example for this language.',
    ]),
    'ai.compatible': base['ai.openai'],
    'ai.embeddings': comments([
      'Implement embedding calls through the generated AxAI client surface when present.',
      'Use package conformance coverage to confirm current support for this language.',
    ]),
    'ai.audio': comments([
      'See audio_responses_mapping and realtime_audio_events examples for this package.',
      'They show batch audio mapping and realtime event normalization.',
    ]),
    'ai.thinking': comments([
      'Thinking budgets are provider-specific runtime options.',
      'Trace usage and provider metadata before relying on a budget in production.',
    ]),
    'ai.catalog': comments([
      'TypeScript exposes the bundled model catalog helper.',
      'Generated packages publish capability metadata in axir-capabilities.json.',
    ]),
    'optimize.flow': base['optimize.axgen'],
    'optimize.agent': base['optimize.axgen'],
    'optimize.artifact': base['optimize.axgen'],
  };
}

function standardSchemaSection(language) {
  if (language.id !== 'typescript') {
    return [
      '## Standard Schema',
      '',
      'Standard Schema support is a TypeScript surface today. Use it when you want zod, valibot, or arktype constraints to sit beside the Ax signature and feed the validation/retry loop.',
      '',
      'Generated language packages expose the AxIR-supported signature and JSON-schema surfaces for their native package. They preserve the same contract idea, but they do not pretend that TypeScript schema libraries exist in the target language.',
    ].join('\n');
  }

  return [
    '## Standard Schema',
    '',
    'TypeScript accepts any Standard Schema v1 validator through the fluent builder. That includes zod, valibot, and arktype. You can attach schemas field-by-field, decompose a whole object schema into fields, and pass Ax-only companion options for cache and internal fields.',
    '',
    snippetBlock(
      { ...language, fence: 'typescript' },
      'signatures.standardSchema'
    ),
    '',
    'The same idea works for tools. `fn().arg()`, `.returns()`, and `.returnsField()` accept Standard Schema validators so the handler gets typed arguments and Ax gets validation feedback.',
    '',
    snippetBlock({ ...language, fence: 'typescript' }, 'signatures.toolSchema'),
  ].join('\n');
}

function aiProviderExamples(language) {
  if (language.id !== 'typescript') {
    return [
      '### Generated Package Provider Path',
      '',
      `The ${language.label} package exposes the AxIR-supported provider surface. Public examples use OpenAI-compatible clients, while internal fixtures cover provider normalization without credentials.`,
      '',
      snippetBlock(language, 'ai.openai'),
      '',
      'Use the generated package examples for exact provider API runs, stream mapping, Responses audio mapping, and realtime event folding for this language.',
    ].join('\n');
  }

  return [
    '### OpenAI',
    '',
    snippetBlock(language, 'ai.openai'),
    '',
    '### OpenAI Responses',
    '',
    snippetBlock(language, 'ai.responses'),
    '',
    '### Claude / Anthropic',
    '',
    snippetBlock(language, 'ai.claude'),
    '',
    '### Gemini',
    '',
    snippetBlock(language, 'ai.gemini'),
    '',
    '### OpenAI-Compatible Providers',
    '',
    'Use `apiURL` when a provider shares the OpenAI wire shape but uses a different host or model naming scheme.',
    '',
    snippetBlock(language, 'ai.compatible'),
  ].join('\n');
}

function examplesLanding(language, examples) {
  const groups = groupPublicExamples(examples);
  if (groups.length === 0) {
    return [
      'No public provider-backed examples are currently published for this language.',
      '',
      'Add a runnable file under `src/examples/<language>/<group>/` with an `ax-example` metadata header to publish one.',
    ].join('\n');
  }

  const out = [
    `Every ${language.label} example here is runnable source under \`src/examples/${language.id}/\` and calls a real provider API. The website and \`npm run example -- list\` are generated from each file's \`ax-example\` header.`,
    '',
    '## Groups',
    '',
    ...groups.map(
      (group) =>
        `- [${group.title}](/${language.id}/examples/${group.slug}/) - ${group.examples.length} example${group.examples.length === 1 ? '' : 's'}.`
    ),
  ];

  for (const group of groups) {
    out.push('', `## ${group.title}`, '');
    for (const example of group.examples) {
      out.push(
        `- [${example.title}](/${language.id}/examples/${group.slug}/) - ${example.description} Run: \`${example.command}\`.`
      );
    }
  }

  return out.join('\n');
}

function renderExampleGroupPage(language, group) {
  const out = [
    `These ${language.label} examples are real runnable files. Edit the source file first; this page is rebuilt from the checked-in example and its metadata header.`,
  ];

  for (const example of group.examples) {
    out.push(
      '',
      `## ${example.title}`,
      '',
      example.description,
      '',
      `- Provider: \`${example.provider}\``,
      `- Env: ${example.env.map((name) => `\`${name}\``).join(', ')}`,
      `- Level: \`${example.level}\``,
      `- Run: \`${example.command}\``,
      `- Source: [${example.sourcePath}](${githubBlob}/${example.sourcePath})`,
      '',
      codeFence(example.language.fence, example.code)
    );
  }

  return out.join('\n');
}

function advancedStart(language, examples) {
  const story = examples
    .filter((example) => Number.isFinite(example.story))
    .sort(
      (left, right) =>
        left.story - right.story ||
        left.order - right.order ||
        left.title.localeCompare(right.title)
    );

  if (story.length === 0) {
    return [
      `No ${language.label} examples are currently marked for Advanced Start.`,
      '',
      'Add `story: <number>` to an `ax-example` header to include it in this path.',
    ].join('\n');
  }

  const out = [
    `Advanced Start is built from runnable ${language.label} examples. The story below follows the same source files that appear under Examples, so code changes start in \`src/examples/${language.id}/\`.`,
  ];

  for (const example of story) {
    out.push(
      '',
      `## ${example.title}`,
      '',
      advancedStartNarrative(example),
      '',
      example.description,
      '',
      `- Level: \`${example.level}\``,
      `- Run: \`${example.command}\``,
      `- Source: [${example.sourcePath}](${githubBlob}/${example.sourcePath})`,
      `- More in this group: [${exampleGroupLabels.get(example.group) ?? example.group} examples](/${language.id}/examples/${example.group}/)`,
      '',
      codeFence(example.language.fence, example.code)
    );
  }

  return out.join('\n');
}

function advancedStartNarrative(example) {
  const narratives = {
    generation:
      'Start with a typed contract: the model receives named inputs and Ax parses named outputs.',
    'short-agents':
      'Move to an agent when the model needs a runtime loop and a final typed answer.',
    flows:
      'Use a flow when the application should own the order of multi-step work.',
    audio:
      'Add audio when the same provider-backed contract should accept or produce speech.',
    optimization:
      'Close the loop by measuring examples and applying optimizer artifacts to the program.',
  };
  return (
    narratives[example.group] ??
    'Use this runnable example as the next step in the Ax path.'
  );
}

function normalizedExamples(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item?.code) return String(item.code).trim();
        if (item?.example) return String(item.example).trim();
        return '';
      })
      .filter(Boolean);
  }
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  return [];
}

function normalizedParameters(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      name: stripInlineMarkdown(item.name ?? item.parameter ?? ''),
      type: item.type ?? item.form ?? '',
      description: item.description ?? item.notes ?? '',
    }))
    .filter((item) => item.name);
}

function codeFence(language, code) {
  return [`\`\`\`${language}`, code.trim(), '```'].join('\n');
}

function sourceCell(source) {
  const value = String(source);
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return `[source](${value})`;
  }
  return `\`${escapePipes(value)}\``;
}

function stripInlineMarkdown(value) {
  return String(value ?? '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\\\|/g, '|')
    .trim();
}

function typeDocReferenceList(pages) {
  return [
    '| Symbol | Source |',
    '| --- | --- |',
    ...pages.map(
      (page) =>
        `| [\`${page.title}\`](/typescript/api/reference/${page.slug}/) | \`${page.source}\` |`
    ),
  ].join('\n');
}

function inventoryBullets(language, packageInventory, subsystem, inventory) {
  if (language.id === 'typescript') {
    const exports = relevantExports(subsystem, inventory.publicExports);
    return [
      ...exports.map(
        (name) => `- \`${name}\` is exported from \`src/ax/index.ts\`.`
      ),
      `- Source skill docs scanned: ${inventory.skillDocs
        .filter((doc) => skillMatchesSubsystem(doc.rel, subsystem))
        .map((doc) => `\`${doc.rel}\``)
        .join(', ')}`,
    ].join('\n');
  }

  const capabilities = packageInventory?.capabilities;
  const sections = apiRowsFor(language, subsystem, inventory);
  const profiles = capabilities?.runtime_profiles ?? [];
  return [
    `- Generated package: \`${language.packageName}\` from AxIR contract \`${capabilities?.axir_version ?? 'unknown'}\`.`,
    `- Provider mode: \`${capabilities?.provider_mode ?? 'unknown'}\`.`,
    `- Subsystem symbols mapped: ${sections.length}.`,
    profiles.length > 0
      ? `- Runtime profiles: ${profiles.map((profile) => `\`${profile.id}\``).join(', ')}.`
      : '- Runtime profiles: none claimed for this package.',
  ].join('\n');
}

function relevantExports(subsystem, exports) {
  const keywords = typedocKeywordFallback[subsystem];
  return [...exports]
    .filter((name) =>
      keywords.some((keyword) => {
        const needle = keyword.toLowerCase();
        if (needle.length <= 2) return name.toLowerCase() === needle;
        return name.toLowerCase().includes(needle);
      })
    )
    .sort()
    .slice(0, 24);
}

function skillMatchesSubsystem(rel, subsystem) {
  const name = path.basename(rel);
  if (subsystem === 'ai') return name.includes('ai') || name.includes('audio');
  if (subsystem === 'ax') return name.includes('gen');
  if (subsystem === 's') return name.includes('signature');
  if (subsystem === 'agent') return name.includes('agent');
  if (subsystem === 'optimize')
    return name.includes('gepa') || name.includes('optimize');
  return false;
}

function examplesSource(language) {
  return [
    '- Catalog: `npm run example -- list --json` from `scripts/example-catalog.mjs`',
    `- Files: \`src/examples/${language.id}/\``,
  ].join('\n');
}

function skillInstallURL(language) {
  return (
    language.skillsInstallURL ?? `https://ax-llm.github.io/ax/${language.id}/`
  );
}

function skillInstallCommand(language) {
  return `npx skills add ${skillInstallURL(language)} --skill '*'`;
}

function skillPageSlug(skill) {
  return slugify(skill.name);
}

function skillCommonName(language, skill) {
  const languagePrefix =
    language.id === 'typescript' ? 'ax-' : `ax-${language.id}-`;
  return skill.name.startsWith(languagePrefix)
    ? skill.name.slice(languagePrefix.length)
    : skill.name.replace(/^ax-/, '');
}

function skillSlugKey(language, skill) {
  const commonName = skillCommonName(language, skill);
  return `skill-${slugify(commonName)}`;
}

function skillSortName(languageId, skill) {
  const language = { id: languageId };
  const commonName = skillCommonName(language, skill);
  const index = skillNavOrder.indexOf(commonName);
  const order = index === -1 ? 99 : index;
  return `${String(order).padStart(2, '0')}-${commonName}`;
}

function skillNavTitle(language, skill) {
  const commonName = skillCommonName(language, skill);
  return skillNavLabels.get(commonName) ?? titleCase(commonName);
}

function skillPageTitle(skill) {
  return parseMarkdownHeading(stripFrontmatter(skill.content)) ?? skill.name;
}

function renderSkillPage(language, skill) {
  const title = skillPageTitle(skill);
  const body = stripFirstHeading(stripFrontmatter(skill.content));
  const publishedURL = `/${language.id}/.well-known/agent-skills/${skill.name}/SKILL.md`;
  return [
    `# ${title}`,
    '',
    skill.description,
    '',
    '## Install',
    '',
    `Install only this skill for ${language.label}:`,
    '',
    '```bash',
    `npx skills add ${skillInstallURL(language)} --skill '${skill.name}'`,
    '```',
    '',
    `Published skill file: [${skill.name}/SKILL.md](${publishedURL}).`,
    '',
    '## Source',
    '',
    `- Source: [${skill.source}](${githubBlob}/${skill.source})`,
    `- Version: \`${skill.version ?? 'package version'}\``,
    '',
    '## Skill Instructions',
    '',
    body,
  ].join('\n');
}

function stripFirstHeading(markdown) {
  return markdown
    .trimStart()
    .replace(/^#\s+.+\n+/, '')
    .trim();
}

function skillList(skills, language) {
  if (skills.length === 0) {
    return '- No package skills are currently published for this language.';
  }
  return skills
    .map(
      (skill) =>
        `- [${skillNavTitle(language, skill)}](/${language.id}/skills/${skillPageSlug(skill)}/) - \`${skill.name}\`: ${escapePipes(skill.description)} Source: \`${skill.source}\`.`
    )
    .join('\n');
}

function skillSource(language) {
  if (language.id === 'typescript') {
    return '`src/ax/skills/*.md` with package-version injection for website install artifacts.';
  }
  return `\`packages/${language.id}/skills/**/SKILL.md\`, generated by the AxIR package compiler.`;
}

function inventoryNote(inventory, language) {
  const packageInventory = inventory.packages[language.id];
  return [
    '## Source Audit',
    '',
    `This page was generated from current repo state: ${inventory.publicExports.size} public TypeScript exports, ${inventory.skillDocs.length} skill docs, ${inventory.examples[language.id]?.length ?? 0} ${language.label} examples, and ${
      packageInventory?.apiSections.length ?? inventory.typedocPages.length
    } API sections/pages.`,
  ].join('\n');
}

function sourceForPage(language, page) {
  if (page.slug === 'examples') {
    return `src/examples/${language.id}`;
  }
  if (page.template === 'api') {
    return language.apiKind === 'typedoc'
      ? 'build/apidocs'
      : `packages/${language.id}/axir-api.json`;
  }
  return `website/content-src/templates/${page.template}.md`;
}

function subsystemFromSlug(slug) {
  if (slug.endsWith('/ai')) return 'ai';
  if (slug.endsWith('/ax')) return 'ax';
  if (slug.endsWith('/s')) return 's';
  if (slug.endsWith('/agent')) return 'agent';
  if (slug.endsWith('/optimize')) return 'optimize';
  if (slug.includes('llms')) return 'ai';
  if (slug.includes('signatures')) return 's';
  if (slug.includes('agents')) return 'agent';
  if (slug.includes('optimization')) return 'optimize';
  return 'ax';
}

function renderTemplate(template, context) {
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (match, key) => {
    if (Object.hasOwn(context, key)) return String(context[key]);
    return match;
  });
}

function rewriteLanguageLinks(markdown, language) {
  return markdown.replace(
    /\]\((\/)?(?:docs|examples|backends|api)[^)#]*(#[^)]+)?\)/g,
    (match) => match.replace(/\]\([^)]+\)/, `](/${language.id}/quick-start/)`)
  );
}

function rewriteTypeDocLinks(markdown) {
  return markdown.replaceAll('/apidocs/', '/typescript/api/reference/');
}

async function readLanguages(ids) {
  const languages = [];
  for (const id of ids) {
    languages.push(
      await readJson(path.join(contentSrcRoot, 'languages', `${id}.json`))
    );
  }
  return languages;
}

async function readTemplates() {
  const templatesRoot = path.join(contentSrcRoot, 'templates');
  const files = (await readdir(templatesRoot)).filter((file) =>
    file.endsWith('.md')
  );
  const templates = new Map();
  for (const file of files) {
    templates.set(
      file.replace(/\.md$/, ''),
      await readFile(path.join(templatesRoot, file), 'utf8')
    );
  }
  return templates;
}

async function copyMermaidVendor() {
  const source = path.join(repoRoot, 'node_modules/mermaid/dist');
  const entry = path.join(source, 'mermaid.esm.min.mjs');
  const chunks = path.join(source, 'chunks');
  if (!(await exists(entry))) {
    throw new Error(
      'Missing Mermaid bundle. Run `npm install` before `npm run website:prepare`.'
    );
  }
  const vendorRoot = path.join(siteRoot, 'static', 'vendor');
  const destination = path.join(vendorRoot, 'mermaid');
  await rm(vendorRoot, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await copyFile(entry, path.join(destination, 'mermaid.esm.min.mjs'));
  const chunkDestination = path.join(destination, 'chunks');
  await rm(chunkDestination, { recursive: true, force: true });
  await cp(chunks, chunkDestination, { recursive: true });
}

async function writeRedirectPage(relPath, page) {
  await writePage(relPath, {
    title: page.title,
    description: page.description,
    weight: 0,
    generated: true,
    language: page.language.id,
    slug_key: 'quick-start',
    section_nav: 'quick-start',
    body_class: 'docs-quick-start',
    toc: false,
    redirect_to: page.redirectTo,
    source: 'website/content-src/site-map.json',
    body: [
      `# ${page.title}`,
      '',
      `Continue to [${page.linkText ?? 'Quick Start'}](${page.redirectTo}).`,
    ].join('\n'),
  });
}

async function writePage(relPath, page) {
  const abs = path.join(generatedContentRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(
    abs,
    `${frontmatter(page)}\n${ensureTrailingNewline(page.body)}`,
    'utf8'
  );
}

function frontmatter(page) {
  const fields = {
    title: page.title,
    description: page.description,
    weight: page.weight,
    generated: page.generated,
    language: page.language,
    slug_key: page.slug_key,
    nav_group: page.nav_group,
    section_nav: page.section_nav,
    body_class: page.body_class,
    redirect_to: page.redirect_to,
    toc: page.toc,
    standalone: page.standalone,
    academy: page.academy,
    academy_page: page.academy_page,
    source: page.source,
  };
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${yamlString(value)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function stripFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) return markdown;
  const end = markdown.indexOf('\n---', 4);
  if (end === -1) return markdown;
  return markdown.slice(markdown.indexOf('\n', end + 4) + 1);
}

function parseFrontmatterTitle(markdown) {
  if (!markdown.startsWith('---\n')) return undefined;
  const end = markdown.indexOf('\n---', 4);
  if (end === -1) return undefined;
  const fm = markdown.slice(4, end);
  const match = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  return match?.[1];
}

function parseSkillFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) return {};
  const end = markdown.indexOf('\n---', 4);
  if (end === -1) return {};
  const fm = markdown.slice(4, end);
  return {
    name: frontmatterField(fm, 'name'),
    description: frontmatterField(fm, 'description'),
    version: frontmatterField(fm, 'version'),
  };
}

function frontmatterField(frontmatterText, key) {
  const match = frontmatterText.match(
    new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'm')
  );
  return match?.[1]?.trim();
}

function parseMarkdownHeading(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1];
}

function ensureMarkdownHeading(title, markdown) {
  if (/^#\s+/m.test(markdown.trimStart())) return markdown;
  return `# ${title}\n\n${markdown}`;
}

function typedocSlug(rel) {
  return rel
    .replace(/\.md$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function titleCase(value) {
  return String(value)
    .replace(/[-_.]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function titleFromFile(rel) {
  return rel
    .replace(/\.md$/, '')
    .replace(/[-_.]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function kindFromTypedocRel(rel) {
  const [kind] = rel.split('.');
  return kind ? kind.toLowerCase() : 'symbol';
}

function escapePipes(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function lines(value) {
  return Array.isArray(value) ? value.join('\n') : String(value ?? '');
}

function sha256Digest(data) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

async function listFiles(root) {
  const out = [];
  await visit(root);
  return out;

  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function ensureTrailingNewline(value) {
  return value.endsWith('\n') ? value : `${value}\n`;
}
