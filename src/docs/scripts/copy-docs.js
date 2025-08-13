import fs from 'node:fs';
import path from 'node:path';

// Paths
const rootDir = path.join(process.cwd(), '..', '..');
const docsDir = path.join(rootDir, 'docs');
const contentDir = path.join(process.cwd(), 'src', 'content', 'docs');
const publicDir = path.join(process.cwd(), 'public');

// Files to copy with metadata
const filesToCopy = [
  {
    source: 'README.md',
    sourceDir: rootDir, // README stays in root
    dest: 'readme.md',
    title: 'Documentation',
    description: 'Ax - Build Reliable AI Apps in TypeScript',
  },
  {
    source: 'QUICKSTART.md',
    sourceDir: docsDir,
    dest: 'quickstart.md',
    title: 'Quick Start',
    description: 'Get from zero to your first AI application in 5 minutes',
  },
  {
    source: 'DSPY.md',
    sourceDir: docsDir,
    dest: 'dspy.md',
    title: 'DSPy Concepts',
    description: 'The revolutionary approach to building with LLMs',
  },
  {
    source: 'SIGNATURES.md',
    sourceDir: docsDir,
    dest: 'signatures.md',
    title: 'Signatures Guide',
    description:
      'Complete guide to DSPy signatures - from basics to advanced patterns',
  },
  {
    source: 'AI.md',
    sourceDir: docsDir,
    dest: 'ai.md',
    title: 'AI Providers',
    description:
      'Complete guide to all supported AI providers and their features',
  },
  {
    source: 'OPTIMIZE.md',
    sourceDir: docsDir,
    dest: 'optimize.md',
    title: 'Optimization Guide',
    description: "LLM Optimization Made Simple: A Beginner's Guide to Ax",
  },
  {
    source: 'AXFLOW.md',
    sourceDir: docsDir,
    dest: 'axflow.md',
    title: 'AxFlow Guide',
    description:
      'AxFlow - Orchestration framework for building AI workflows with Ax',
  },
  {
    source: 'TELEMETRY.md',
    sourceDir: docsDir,
    dest: 'telemetry.md',
    title: 'Telemetry Guide',
    description: 'Observability and monitoring for Ax applications',
  },
  {
    source: 'AXRAG.md',
    sourceDir: docsDir,
    dest: 'axrag.md',
    title: 'AxRAG Guide',
    description:
      'Advanced RAG with multi-hop retrieval and self-healing quality loops',
  },
  {
    source: 'MIGRATION.md',
    sourceDir: docsDir,
    dest: 'migration.md',
    title: 'Migration Guide',
    description: 'Complete migration guide for Ax v13.0.24+ API changes',
  },
];

// Ensure directories exist
if (!fs.existsSync(contentDir)) {
  fs.mkdirSync(contentDir, { recursive: true });
}
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Function to rewrite relative links for Astro
function rewriteRelativeLinks(content, _currentFile) {
  let modifiedContent = content;

  // Rewrite relative markdown links to point to docs routes
  // [text](./FILE.md) -> [text](/docs/file)
  // [text](../FILE.md) -> [text](/docs/file)
  modifiedContent = modifiedContent.replace(
    /\[([^\]]+)\]\(\.?\/?([A-Z]+)\.md\)/gi,
    (_match, text, file) => {
      const route = file.toLowerCase();
      return `[${text}](/docs/${route})`;
    }
  );

  // Rewrite src/ paths to GitHub URLs
  modifiedContent = modifiedContent.replace(
    /\[([^\]]+)\]\((\.\.\/)?src\/([^)]+)\)/g,
    (_match, text, _dots, path) => {
      return `[${text}](https://github.com/AxAI-Dev/ax/tree/main/src/${path})`;
    }
  );

  return modifiedContent;
}

// Collect all content for llm.txt
let llmContent = `# Ax Framework Documentation
# Generated from project documentation
# Last updated: ${new Date().toISOString()}

================================================================================

`;

// Copy files and add frontmatter
for (const file of filesToCopy) {
  const sourcePath = path.join(file.sourceDir || rootDir, file.source);
  const destPath = path.join(contentDir, file.dest);

  if (fs.existsSync(sourcePath)) {
    let content = fs.readFileSync(sourcePath, 'utf-8');

    // Store original content for llm.txt before modifications
    const originalContent = content;

    // Remove existing frontmatter if present
    if (content.startsWith('---')) {
      const endOfFrontmatter = content.indexOf('---', 3);
      if (endOfFrontmatter !== -1) {
        content = content.substring(endOfFrontmatter + 3).trimStart();
      }
    }

    // Rewrite relative links for Astro
    content = rewriteRelativeLinks(content, file.source);

    // Add new frontmatter
    const frontmatter = `---
title: "${file.title}"
description: "${file.description}"
---

`;

    const finalContent = frontmatter + content;
    fs.writeFileSync(destPath, finalContent, 'utf-8');
    console.log(
      `✓ Copied ${file.source} → src/content/docs/${file.dest} (with frontmatter)`
    );

    // Add to llm.txt content (using original without frontmatter modifications)
    llmContent += `
# ${file.title}
# Source: ${file.source}
# ${file.description}

${originalContent}

================================================================================

`;
  } else {
    console.warn(`⚠ Warning: ${file.source} not found at ${sourcePath}`);
  }
}

// Write llm.txt to public folder
const llmPath = path.join(publicDir, 'llm.txt');
fs.writeFileSync(llmPath, llmContent, 'utf-8');
console.log(`✓ Generated public/llm.txt with all documentation`);

console.log('📚 Documentation files copied successfully!');
