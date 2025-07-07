#!/usr/bin/env node

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Core dependencies that should be included in new packages
const CORE_DEPENDENCIES = [
  '@ax-llm/ax'
]

// Files to copy from src/ax (excluding generated files and directories)
const FILES_TO_COPY = [
  'tsconfig.json',
  'tsup.config.ts', 
  '.prettierignore',
  '.release-it.json'
]

// Scripts to exclude from ax package.json (package-specific scripts)
const SCRIPTS_TO_EXCLUDE = [
  'build:index',  // This is specific to the main ax package
  'doc:build:markdown'  // This might be specific to main package
]

async function initPackage() {
  const packageName = process.argv[2]
  const packageDescription = process.argv[3] || `${packageName} package for Ax`
  const additionalDeps = process.argv[4] ? process.argv[4].split(',').map(dep => dep.trim()) : []

  if (!packageName) {
    console.error('Usage: node scripts/initPackage.js <package-name> [description] [additional-deps]')
    console.error('Example: node scripts/initPackage.js my-new-package "My new package description"')
    console.error('Example: node scripts/initPackage.js vector-store "Vector store impl" "zod,uuid"')
    process.exit(1)
  }

  // Validate package name
  if (!/^[a-z][a-z0-9-]*$/.test(packageName)) {
    console.error('Package name must be lowercase, start with a letter, and contain only letters, numbers, and hyphens')
    process.exit(1)
  }

  const rootDir = path.resolve(__dirname, '..')
  const srcDir = path.join(rootDir, 'src')
  const packageDir = path.join(srcDir, packageName)
  const axDir = path.join(srcDir, 'ax')

  // Check if package already exists
  try {
    await fs.access(packageDir)
    console.error(`Package '${packageName}' already exists at ${packageDir}`)
    process.exit(1)
  } catch {
    // Package doesn't exist, which is what we want
  }

  // Read root package.json to get current version
  const rootPackageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'))
  const currentVersion = rootPackageJson.version

  // Read ax package.json to get base structure
  const axPackageJson = JSON.parse(await fs.readFile(path.join(axDir, 'package.json'), 'utf8'))

  console.log(`Creating new package: ${packageName}`)
  console.log(`Package directory: ${packageDir}`)
  if (additionalDeps.length > 0) {
    console.log(`Additional dependencies: ${additionalDeps.join(', ')}`)
  }

  // Create package directory
  await fs.mkdir(packageDir, { recursive: true })

  // Create package.json based on ax package.json but filtered
  const filteredScripts = { ...axPackageJson.scripts }
  SCRIPTS_TO_EXCLUDE.forEach(script => {
    delete filteredScripts[script]
  })
  
  // Fix the build script to not include build:index
  if (filteredScripts.build && filteredScripts.build.includes('build:index')) {
    filteredScripts.build = 'tsup'
  }

  const packageJson = {
    ...axPackageJson,
    name: `@ax-llm/ax-${packageName}`,
    version: currentVersion,
    description: packageDescription,
    scripts: filteredScripts,
    // Filter dependencies to only include core ones and additional specified deps
    dependencies: [...CORE_DEPENDENCIES, ...additionalDeps].reduce((deps, dep) => {
      if (dep === '@ax-llm/ax') {
        deps[dep] = currentVersion
      } else if (axPackageJson.dependencies && axPackageJson.dependencies[dep]) {
        deps[dep] = axPackageJson.dependencies[dep]
      } else if (rootPackageJson.dependencies && rootPackageJson.dependencies[dep]) {
        deps[dep] = rootPackageJson.dependencies[dep]
      } else if (additionalDeps.includes(dep)) {
        // For additional deps not found in existing packages, use latest
        deps[dep] = '^latest'
        console.warn(`  ⚠ Dependency '${dep}' not found in existing packages, using '^latest'`)
      }
      return deps
    }, {}),
    // Keep devDependencies empty for new packages
    devDependencies: {},
    // Remove ax-specific fields
    ava: undefined,
    tsd: undefined,
    files: ['**/*']
  }

  await fs.writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n'
  )

  // Copy configuration files from src/ax
  console.log('Copying configuration files from src/ax...')
  for (const file of FILES_TO_COPY) {
    const sourcePath = path.join(axDir, file)
    const destPath = path.join(packageDir, file)
    
    try {
      await fs.copyFile(sourcePath, destPath)
      console.log(`  ✓ Copied ${file}`)
    } catch (error) {
      console.warn(`  ⚠ Could not copy ${file}: ${error.message}`)
    }
  }

  // Create index.ts
  const indexTs = `// Export your main functionality here
export * from './lib.js'
`

  await fs.writeFile(path.join(packageDir, 'index.ts'), indexTs)

  // Create lib.ts (main implementation file)
  const libTs = `/**
 * ${packageDescription}
 */

export class ${toPascalCase(packageName)} {
  constructor() {
    // Initialize your class here
  }

  /**
   * Example method
   */
  hello(): string {
    return 'Hello from ${packageName}!'
  }
}

/**
 * Example function
 */
export function create${toPascalCase(packageName)}(): ${toPascalCase(packageName)} {
  return new ${toPascalCase(packageName)}()
}
`

  await fs.writeFile(path.join(packageDir, 'lib.ts'), libTs)

  // Create index.test.ts
  const indexTest = `import { describe, expect, it } from 'vitest'

import { ${toPascalCase(packageName)}, create${toPascalCase(packageName)} } from './index.js'

describe('${toPascalCase(packageName)}', () => {
  it('should create instance', () => {
    const instance = new ${toPascalCase(packageName)}()
    expect(instance).toBeInstanceOf(${toPascalCase(packageName)})
  })

  it('should say hello', () => {
    const instance = create${toPascalCase(packageName)}()
    expect(instance.hello()).toBe('Hello from ${packageName}!')
  })
})
`

  await fs.writeFile(path.join(packageDir, 'index.test.ts'), indexTest)

  // Create README.md
  const readme = `# @ax-llm/ax-${packageName}

${packageDescription}

## Installation

\`\`\`shell
npm i @ax-llm/ax-${packageName}
\`\`\`

## Usage

\`\`\`typescript
import { ${toPascalCase(packageName)}, create${toPascalCase(packageName)} } from '@ax-llm/ax-${packageName}'

// Create an instance
const instance = create${toPascalCase(packageName)}()

// Use the instance
console.log(instance.hello())
\`\`\`

## API

### \`${toPascalCase(packageName)}\`

Main class for ${packageName} functionality.

#### Methods

- \`hello(): string\` - Returns a greeting message

### \`create${toPascalCase(packageName)}()\`

Factory function to create a new \`${toPascalCase(packageName)}\` instance.

## License

Apache-2.0
`

  await fs.writeFile(path.join(packageDir, 'README.md'), readme)

  console.log(`✅ Package '${packageName}' created successfully!`)
  console.log('\nNext steps:')
  console.log(`1. Install dependencies: npm install`)
  console.log(`2. Build the package: npm run build --workspace=@ax-llm/ax-${packageName}`)
  console.log(`3. Run tests: npm run test --workspace=@ax-llm/ax-${packageName}`)
  console.log(`4. Start developing in: ${packageDir}`)
}

function toPascalCase(str) {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

initPackage().catch(console.error) 