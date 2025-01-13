#!/usr/bin/env tsx
import * as fs from 'fs'
import * as path from 'path'

import * as ts from 'typescript'

/**
 * Represents an exported symbol from a TypeScript file
 */
interface ExportInfo {
  /** Original name of the exported symbol */
  originalName: string
  /** Name with prefix (same as originalName currently) */
  prefixedName: string
  /** Whether this is a type or value export */
  kind: 'type' | 'value'
  /** Whether this is a default export */
  isDefault?: boolean
}

/**
 * Checks if a symbol name starts with the expected prefixes (ax or Ax)
 */
function hasValidPrefix(name: string): boolean {
  return name.startsWith('ax') || name.startsWith('Ax')
}

/**
 * Processes an export declaration node to extract exports with valid prefixes
 */
function processExportDeclaration(node: ts.ExportDeclaration): ExportInfo[] {
  const exportsMap = new Map<string, ExportInfo>()

  if (node.exportClause && ts.isNamedExports(node.exportClause)) {
    node.exportClause.elements.forEach((element) => {
      const originalName = element.name.text
      if (hasValidPrefix(originalName)) {
        // Only add if not already present
        const key = `${originalName}:${element.isTypeOnly ? 'type' : 'value'}`
        if (!exportsMap.has(key)) {
          exportsMap.set(key, {
            originalName,
            prefixedName: originalName,
            kind: element.isTypeOnly ? 'type' : 'value',
          })
        }
      }
    })
  }

  return Array.from(exportsMap.values())
}

/**
 * Processes an export assignment (default export) node
 */
function processExportAssignment(node: ts.ExportAssignment): ExportInfo[] {
  const exports: ExportInfo[] = []

  if (ts.isIdentifier(node.expression)) {
    const originalName = node.expression.text
    if (hasValidPrefix(originalName)) {
      exports.push({
        originalName,
        prefixedName: originalName,
        kind: 'value',
        isDefault: true,
      })
    }
  }

  return exports
}

/**
 * Processes a declaration node (class, interface, or type alias)
 */
function processDeclaration(
  node:
    | ts.ClassDeclaration
    | ts.InterfaceDeclaration
    | ts.TypeAliasDeclaration
    | ts.EnumDeclaration
    | ts.FunctionDeclaration
): ExportInfo[] {
  const exports: ExportInfo[] = []

  if (
    node.name &&
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  ) {
    const originalName = node.name.text
    if (hasValidPrefix(originalName)) {
      const isTypeNode =
        ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
      exports.push({
        originalName,
        prefixedName: originalName,
        kind: isTypeNode ? 'type' : 'value',
      })
    }
  }

  return exports
}

/**
 * Processes a TypeScript source file to extract all exports with valid prefixes
 */
function processFile(
  filePath: string,
  rootDir: string,
  exportMap: Map<string, ExportInfo[]>
): void {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf-8'),
    ts.ScriptTarget.Latest,
    true
  )

  const exports: ExportInfo[] = []

  function visit(node: ts.Node) {
    if (ts.isExportDeclaration(node)) {
      exports.push(...processExportDeclaration(node))
    } else if (ts.isExportAssignment(node)) {
      exports.push(...processExportAssignment(node))
    } else if (
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isFunctionDeclaration(node)
    ) {
      exports.push(...processDeclaration(node))
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  if (exports.length > 0) {
    const relativePath = path.relative(rootDir, filePath).replace(/\.ts$/, '')

    // Deduplicate exports based on originalName and kind
    const uniqueExports = exports.reduce((acc: ExportInfo[], curr) => {
      const exists = acc.some(
        (exp) =>
          exp.originalName === curr.originalName && exp.kind === curr.kind
      )
      if (!exists) {
        acc.push(curr)
      }
      return acc
    }, [])

    exportMap.set(relativePath, uniqueExports)
  }
}

/**
 * Recursively finds all TypeScript files in a directory
 */
function findTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return findTsFiles(fullPath)
    } else if (isTargetTsFile(entry.name)) {
      return [fullPath]
    }
    return []
  })
}

/**
 * Checks if a filename matches our target TypeScript files
 */
function isTargetTsFile(filename: string): boolean {
  return (
    filename.endsWith('.ts') &&
    !filename.endsWith('.test.ts') &&
    !filename.endsWith('.d.ts') &&
    filename !== 'index.ts'
  )
}

/**
 * Formats import items for better readability with line breaks
 */
function formatImportItems(imports: string[]): string {
  if (imports.length <= 1) {
    return imports.join(', ')
  }

  return `\n  ${imports.join(',\n  ')}\n`
}

/**
 * Generates an import statement for a file's exports
 */
function generateImportStatement(
  filePath: string,
  exports: ExportInfo[]
): string {
  // Deduplicate value exports by name
  const uniqueValues = [
    ...new Set(
      exports
        .filter((exp) => exp.kind === 'value')
        .map((exp) => exp.originalName)
    ),
  ].sort()

  // Deduplicate type exports by name
  const uniqueTypes = [
    ...new Set(
      exports
        .filter((exp) => exp.kind === 'type')
        .map((exp) => exp.originalName)
    ),
  ]
    .map((name) => `type ${name}`)
    .sort()

  const allImports = [...uniqueValues, ...uniqueTypes]

  if (allImports.length === 0) {
    return ''
  }

  return `import {${formatImportItems(allImports)}} from './${filePath}.js';`
}

/**
 * Generates export statements for the collected exports
 */
function generateExportStatements(exportMap: Map<string, ExportInfo[]>): {
  valueExports: string[]
  typeExports: string[]
} {
  const valueExports: string[] = []
  const typeExports: string[] = []

  exportMap.forEach((exports) => {
    exports.forEach((exp) => {
      if (exp.kind === 'type') {
        typeExports.push(`export type { ${exp.originalName} };`)
      } else {
        const exportLine = exp.isDefault
          ? `export { ${exp.originalName} as default };`
          : `export { ${exp.originalName} };`
        valueExports.push(exportLine)
      }
    })
  })

  return {
    valueExports: valueExports.sort(),
    typeExports: typeExports.sort(),
  }
}

/**
 * Generates the content for the index.ts file
 */
function generateIndexContent(exportMap: Map<string, ExportInfo[]>): string {
  let content =
    '/* eslint import/order: 0 sort-imports: 0 */\n// Auto-generated index file - Do not edit\n\n'

  // Generate and sort imports
  const imports = Array.from(exportMap.entries())
    .map(([filePath, exports]) => generateImportStatement(filePath, exports))
    .filter(Boolean)
    .sort()
  content += imports.join('\n') + '\n\n'

  // Generate exports
  const { valueExports, typeExports } = generateExportStatements(exportMap)

  if (valueExports.length > 0) {
    content += '// Value exports\n'
    content += valueExports.join('\n') + '\n\n'
  }

  if (typeExports.length > 0) {
    content += '// Type exports\n'
    content += typeExports.join('\n') + '\n'
  }

  return content
}

/**
 * Main function to generate the index.ts file
 */
function generateIndex(): void {
  const currentDir = process.cwd()
  const exportMap = new Map<string, ExportInfo[]>()

  // Find and process all TypeScript files
  const tsFiles = findTsFiles(currentDir)
  tsFiles.forEach((file) => processFile(file, currentDir, exportMap))

  if (exportMap.size === 0) {
    console.log('No ax/Ax exports found')
    return
  }

  // Generate and write index.ts
  const indexContent = generateIndexContent(exportMap)
  const indexPath = path.join(currentDir, 'index.ts')
  fs.writeFileSync(indexPath, indexContent)
  console.log(`Generated ${indexPath} successfully!`)
}

// Run the script
try {
  generateIndex()
} catch (error) {
  console.error('Failed to generate index:', error)
  process.exit(1)
}
