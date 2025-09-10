# initPackage Script

A script to create new packages in the Ax monorepo using the `src/ax` package as
a skeleton template, copying configuration files and filtering dependencies
appropriately.

## Usage

```bash
# Create a new package with default description
npm run init-package <package-name>

# Create a new package with custom description
npm run init-package <package-name> "Custom package description"

# Create a new package with additional dependencies
npm run init-package <package-name> "Custom description" "dep1,dep2,dep3"
```

## Examples

```bash
# Create a new package called "my-extension"
npm run init-package my-extension

# Create a new package with custom description
npm run init-package vector-store "Vector store implementation for Ax"

# Create a new package with additional dependencies
npm run init-package ai-provider "Custom AI provider" "zod,uuid"
```

## What it creates

The script creates a new package under `src/<package-name>/` with the following
structure:

```
src/<package-name>/
├── package.json          # Package configuration with proper workspace setup
├── tsconfig.json         # TypeScript configuration extending root config
├── tsup.config.ts        # Build configuration for ESM/CJS/DTS output
├── index.ts              # Main entry point
├── lib.ts                # Main implementation file
├── index.test.ts         # Vitest test file
├── README.md             # Package documentation
├── .prettierignore       # Prettier ignore rules
└── .release-it.json      # Release configuration
```

## Package Features

Each generated package includes:

- **TypeScript**: Full TypeScript support with proper configuration
- **Build System**: tsup configuration for ESM, CJS, and TypeScript declarations
- **Testing**: Vitest test setup with example tests
- **Linting**: ESLint and Prettier configuration
- **Versioning**: Integrated with monorepo versioning system
- **Publishing**: Ready for npm publishing with proper scoping

## Package Naming

- Package names must be lowercase
- Must start with a letter
- Can contain letters, numbers, and hyphens
- Will be published as `@ax-llm/ax-<package-name>`

## After Creation

After creating a package, you can:

1. Install dependencies: `npm install`
2. Build the package: `npm run build --workspace=@ax-llm/ax-<package-name>`
3. Run tests: `npm run test --workspace=@ax-llm/ax-<package-name>`
4. Start development: `npm run dev --workspace=@ax-llm/ax-<package-name>`

## Template Structure

The script uses the `src/ax` package as a template, ensuring consistency with:

- **Package.json**: Copies structure and scripts from `src/ax`, filtering out
  package-specific scripts like `build:index`
- **Configuration Files**: Copies `tsconfig.json`, `tsup.config.ts`,
  `.prettierignore`, and `.release-it.json` directly from `src/ax`
- **Dependencies**: Intelligently filters dependencies, keeping only core ones
  (`@ax-llm/ax`) plus any additional specified dependencies
- **Scripts**: Inherits all scripts from `src/ax` except package-specific ones,
  with build script simplified to just `tsup`

## Dependency Management

The script intelligently handles dependencies:

1. **Core Dependencies**: Always includes `@ax-llm/ax` with current monorepo
   version
2. **Additional Dependencies**: Looks for specified dependencies in:
   - `src/ax/package.json` dependencies
   - Root `package.json` dependencies
   - Falls back to `^latest` if not found (with warning)
3. **Filtered Dependencies**: Removes all other dependencies from `src/ax` to
   keep packages lean

## Configuration File Copying

Instead of generating configuration files, the script copies them directly from
`src/ax`:

- **tsconfig.json**: Ensures consistent TypeScript configuration
- **tsup.config.ts**: Maintains consistent build setup
- **.prettierignore**: Keeps formatting rules consistent
- **.release-it.json**: Ensures proper release configuration
