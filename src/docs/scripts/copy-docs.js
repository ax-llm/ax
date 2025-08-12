import fs from 'node:fs';
import path from 'node:path';

// Paths
const rootDir = path.join(process.cwd(), '..', '..');
const contentDir = path.join(process.cwd(), 'src', 'content', 'docs');

// Files to copy with metadata
const filesToCopy = [
  {
    source: 'README.md',
    dest: 'readme.md',
    title: 'Documentation',
    description: 'Ax - Build Reliable AI Apps in TypeScript',
  },
  {
    source: 'QUICKSTART.md',
    dest: 'quickstart.md',
    title: 'Quick Start',
    description: 'Get from zero to your first AI application in 5 minutes',
  },
  {
    source: 'DSPY.md',
    dest: 'dspy.md',
    title: 'DSPy Concepts',
    description: 'The revolutionary approach to building with LLMs',
  },
  {
    source: 'API.md',
    dest: 'api.md',
    title: 'API Reference',
    description: 'Complete API documentation for Ax',
  },
  {
    source: 'OPTIMIZE.md',
    dest: 'optimize.md',
    title: 'Optimization Guide',
    description: "LLM Optimization Made Simple: A Beginner's Guide to Ax",
  },
  {
    source: 'AXFLOW.md',
    dest: 'axflow.md',
    title: 'AxFlow Guide',
    description:
      'AxFlow - Orchestration framework for building AI workflows with Ax',
  },
  {
    source: 'TELEMETRY.md',
    dest: 'telemetry.md',
    title: 'Telemetry Guide',
    description: 'Observability and monitoring for Ax applications',
  },
  {
    source: 'AXRAG.md',
    dest: 'axrag.md',
    title: 'AxRAG Guide',
    description:
      'Advanced RAG with multi-hop retrieval and self-healing quality loops',
  },
  {
    source: 'MIGRATION.md',
    dest: 'migration.md',
    title: 'Migration Guide',
    description: 'Complete migration guide for Ax v13.0.24+ API changes',
  },
];

// Ensure content/docs directory exists
if (!fs.existsSync(contentDir)) {
  fs.mkdirSync(contentDir, { recursive: true });
}

// Copy files and add frontmatter
for (const file of filesToCopy) {
  const sourcePath = path.join(rootDir, file.source);
  const destPath = path.join(contentDir, file.dest);

  if (fs.existsSync(sourcePath)) {
    let content = fs.readFileSync(sourcePath, 'utf-8');

    // Remove existing frontmatter if present
    if (content.startsWith('---')) {
      const endOfFrontmatter = content.indexOf('---', 3);
      if (endOfFrontmatter !== -1) {
        content = content.substring(endOfFrontmatter + 3).trimStart();
      }
    }

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
  } else {
    console.warn(`⚠ Warning: ${file.source} not found`);
  }
}

console.log('📚 Documentation files copied successfully!');
