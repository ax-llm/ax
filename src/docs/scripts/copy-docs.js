import fs from 'fs'
import path from 'path'

// Paths
const rootDir = path.join(process.cwd(), '..', '..')
const contentDir = path.join(process.cwd(), 'src', 'content', 'docs')

// Files to copy with metadata
const filesToCopy = [
    {
        source: 'README.md',
        dest: 'readme.md',
        title: 'Documentation',
        description: 'Ax, DSPy for TypeScript - Complete documentation'
    },
    {
        source: 'OPTIMIZE.md',
        dest: 'optimize.md',
        title: 'Optimization Guide',
        description: 'LLM Optimization Made Simple: A Beginner\'s Guide to Ax'
    },
    {
        source: 'AXFLOW.md',
        dest: 'axflow.md',
        title: 'AxFlow Guide',
        description: 'AxFlow - Orchestration framework for building AI workflows with Ax'
    },
    {
        source: 'TELEMETRY.md',
        dest: 'telemetry.md',
        title: 'Telemetry Guide',
        description: 'Observability and monitoring for Ax applications'
    }
]

// Ensure content/docs directory exists
if (!fs.existsSync(contentDir)) {
    fs.mkdirSync(contentDir, { recursive: true })
}

// Copy files and add frontmatter
for (const file of filesToCopy) {
    const sourcePath = path.join(rootDir, file.source)
    const destPath = path.join(contentDir, file.dest)

    if (fs.existsSync(sourcePath)) {
        let content = fs.readFileSync(sourcePath, 'utf-8')

        // Remove existing frontmatter if present
        if (content.startsWith('---')) {
            const endOfFrontmatter = content.indexOf('---', 3)
            if (endOfFrontmatter !== -1) {
                content = content.substring(endOfFrontmatter + 3).trimStart()
            }
        }

        // Add new frontmatter
        const frontmatter = `---
title: "${file.title}"
description: "${file.description}"
---

`

        const finalContent = frontmatter + content
        fs.writeFileSync(destPath, finalContent, 'utf-8')
        console.log(`✓ Copied ${file.source} → src/content/docs/${file.dest} (with frontmatter)`)
    } else {
        console.warn(`⚠ Warning: ${file.source} not found`)
    }
}

console.log('📚 Documentation files copied successfully!') 