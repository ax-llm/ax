# Contributing to Ax

Thank you for your interest in contributing to Ax! This guide will help you get started with contributing code, documentation, examples, or bug reports to the project.

## Welcome

Ax is a TypeScript framework that brings DSPy's declarative approach to building AI applications. We welcome all types of contributions:

- Code improvements and new features
- Documentation updates and guides
- Example applications
- Bug reports and fixes
- Performance optimizations
- Test coverage improvements

For more information about the project, see the [README](../README.md) and [documentation](https://github.com/ax-llm/ax/tree/main/docs).

## Getting Started

### Prerequisites

- **Node.js**: Version 20 or higher (check with `node --version`)
- **npm**: Comes with Node.js
- **Git**: For version control
- **API Keys**: For testing with real AI providers (OpenAI, Anthropic, etc.)

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ax.git
   cd ax
   ```
3. Add the upstream repository:
   ```bash
   git remote add upstream https://github.com/ax-llm/ax.git
   ```

### Install Dependencies

```bash
npm install
```

This installs all dependencies for the monorepo and its workspaces.

### Project Structure

Ax uses a monorepo structure with workspaces:

```
src/
├── ax/           # Core framework package
├── aisdk/        # AI SDK adapter
├── tools/        # Tool integrations
├── aws-bedrock/  # AWS Bedrock provider
├── examples/     # Example applications
└── docs/         # Documentation site
```

For a detailed architecture overview, see [ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Development Setup

### Environment Variables

Create a `.env` file in the project root for testing with real AI providers:

```bash
# OpenAI
OPENAI_APIKEY=your-openai-key

# Anthropic
ANTHROPIC_APIKEY=your-anthropic-key

# Google Gemini
GOOGLE_APIKEY=your-google-key

# Other providers as needed
```

**Note**: Never commit API keys to the repository.

### Running Examples

Test your changes by running examples:

```bash
npm run tsx src/examples/extract.ts
npm run tsx src/examples/agent.ts
npm run tsx src/examples/streaming.ts
```

The `tsx` script automatically loads environment variables from `.env`.

### Development Tools

The project uses:

- **TypeScript**: Type-safe development
- **Biome**: Fast linting and formatting
- **Vitest**: Unit testing framework
- **tsup**: Build tool for packages

## Running Tests

### Unit Tests

Run all tests:

```bash
npm test
```

Run tests for a specific workspace:

```bash
npm test --workspace=@ax-llm/ax
```

Run tests in watch mode during development:

```bash
npm run test --workspace=@ax-llm/ax -- --watch
```

### Integration Tests

Integration tests require real API keys and are located in `src/ax/ai/integration.test.ts`. Set up your `.env` file before running them.

### Test File Conventions

- Unit tests: `*.test.ts` (alongside source files)
- Type tests: `*.test-d.ts` (for TypeScript type checking)
- Test files should be co-located with the code they test

### Writing Tests

Example test structure:

```typescript
import { describe, it, expect } from 'vitest';
import { AxSignature } from './sig.js';

describe('AxSignature', () => {
  it('should parse a simple signature', () => {
    const sig = AxSignature.create('input:string -> output:string');
    expect(sig.getInputFields()).toHaveLength(1);
    expect(sig.getOutputFields()).toHaveLength(1);
  });
});
```

## Coding Standards

### TypeScript Best Practices

- Use explicit types for public APIs
- Prefer `interface` over `type` for object shapes
- Use `readonly` for immutable data
- Avoid `any`; use `unknown` when type is truly unknown
- Document complex types with JSDoc comments

### Code Formatting

The project uses Biome for formatting and linting:

```bash
# Format code
npm run fix:format

# Lint code
npm run fix:lint

# Run both checks and fixes
npm run fix:check
```

Biome configuration is in `biome.jsonc`. The project also uses Prettier for some files (`.prettierrc`).

### File Naming Conventions

- Source files: `kebab-case.ts`
- Test files: `kebab-case.test.ts`
- Type definition files: `kebab-case.test-d.ts`
- Classes: `PascalCase`
- Functions and variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`

### Import Organization

Organize imports in this order:

1. Node.js built-ins
2. External dependencies
3. Internal modules (relative imports)

```typescript
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { AxSignature } from './sig.js';
```

### Documentation Comments

Add JSDoc comments for public APIs:

```typescript
/**
 * Creates a new signature from a string definition.
 * @param signature - The signature string (e.g., "input:string -> output:string")
 * @returns A new AxSignature instance
 * @example
 * ```typescript
 * const sig = AxSignature.create('question:string -> answer:string');
 * ```
 */
export function create(signature: string): AxSignature {
  // Implementation
}
```

## Making Changes

### Creating a Feature Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

Use descriptive branch names:
- `feature/add-new-provider`
- `fix/streaming-validation`
- `docs/update-quickstart`

### Commit Message Conventions

Follow conventional commits format:

```
type(scope): subject

body (optional)

footer (optional)
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding or updating tests
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `chore`: Maintenance tasks

**Examples:**

```
feat(ai): add support for Mistral AI provider

Implements the AxAIMistral class with chat and embed support.
Includes tests and documentation.

Closes #123
```

```
fix(dsp): handle empty array fields in signatures

Previously, empty arrays would cause validation errors.
Now they are properly handled as valid empty arrays.
```

### Keeping Changes Focused

- One feature or fix per pull request
- Keep commits atomic and logical
- Update tests alongside code changes
- Update documentation when adding features

### Updating Documentation

When adding new features:

1. Update relevant documentation in `docs/`
2. Add examples to `src/examples/`
3. Update API documentation comments
4. Add entries to CHANGELOG.md if significant

## Adding New Features

### Adding a New AI Provider

1. Create provider directory: `src/ax/ai/your-provider/`
2. Implement the provider:
   ```typescript
   // src/ax/ai/your-provider/api.ts
   export class AxAIYourProvider extends AxBaseAI<...> {
     constructor(args: AxAIYourProviderArgs) {
       super(aiImpl, {
         name: 'your-provider',
         apiURL: 'https://api.yourprovider.com',
         headers: () => this.buildHeaders(),
         modelInfo: axModelInfoYourProvider,
         defaults: { model: 'default-model' },
         supportFor: (model) => this.getFeatures(model)
       });
     }
   }
   ```
3. Add types in `types.ts`
4. Add model info in `info.ts`
5. Export from `src/ax/ai/index.ts`
6. Add tests in `api.test.ts`
7. Add example in `src/examples/`
8. Update documentation

See [ARCHITECTURE.md](../docs/ARCHITECTURE.md#adding-a-new-ai-provider) for detailed guidance.

### Adding New Field Types

To add a new field type to signatures:

1. Add type to `AxFieldType` in `src/ax/dsp/sigtypes.ts`
2. Add parser in `src/ax/dsp/parser.ts`
3. Add validation in `src/ax/dsp/validate.ts`
4. Update JSON schema generation
5. Add tests
6. Update documentation in [SIGNATURES.md](../docs/SIGNATURES.md)

### Creating Custom Optimizers

1. Create optimizer file in `src/ax/dsp/optimizers/`
2. Implement the optimizer interface:
   ```typescript
   export class MyOptimizer implements AxOptimizer {
     async compile(
       program: AxProgramWithSignature,
       examples: AxExample[],
       metric: AxMetricFn
     ): Promise<AxOptimizedProgram> {
       // Your optimization logic
     }
   }
   ```
3. Add tests
4. Add example usage
5. Document in [OPTIMIZE.md](../docs/OPTIMIZE.md)

### Extending AxFlow

Add new workflow patterns by extending `AxFlow`:

```typescript
class CustomFlow<IN, OUT> extends AxFlow<IN, OUT> {
  public customPattern(...args: any[]) {
    // Implementation
    return this;
  }
}
```

Add examples in `src/examples/` demonstrating the new pattern.

## Submitting Pull Requests

### Before Submitting

Checklist:

- [ ] Tests pass locally (`npm test`)
- [ ] Code is formatted (`npm run fix:check`)
- [ ] No linting errors (`npm run lint`)
- [ ] Documentation is updated
- [ ] Examples are added for new features
- [ ] Commit messages follow conventions
- [ ] Branch is up to date with main

### PR Title and Description

**Title Format:**
```
type(scope): brief description
```

**Description Template:**

```markdown
## Description
Brief description of the changes.

## Motivation
Why is this change needed?

## Changes
- List of changes made
- Another change

## Testing
How was this tested?

## Related Issues
Closes #123
```

### Review Process

1. Automated checks run on all PRs (CI/CD)
2. Maintainers review code and provide feedback
3. Address feedback by pushing new commits
4. Once approved, maintainers will merge

### Responding to Feedback

- Be open to suggestions and constructive criticism
- Ask questions if feedback is unclear
- Make requested changes in new commits
- Mark conversations as resolved when addressed

### CI/CD Checks

All PRs must pass:

- **Build**: Code compiles without errors
- **Tests**: All tests pass
- **Linting**: Code follows style guidelines
- **Type Checking**: TypeScript types are valid

## Documentation Contributions

### Documentation Structure

Documentation lives in:
- `docs/` - Main documentation files (Markdown)
- `src/docs/` - Documentation website (Astro)
- `README.md` - Project overview
- JSDoc comments - API documentation

### Updating Existing Docs

1. Find the relevant file in `docs/`
2. Make your changes
3. Ensure examples still work
4. Submit a PR with `docs:` prefix

### Adding New Guides

1. Create a new file in `docs/`
2. Follow the existing style and structure
3. Add examples and code snippets
4. Link from relevant documentation
5. Update the documentation index

### Documentation Style Guide

- Write in present tense
- Use active voice
- Be direct and avoid fluff
- Include code examples
- Use proper markdown formatting
- Test all code examples

### Building Documentation Locally

```bash
# Build markdown docs
npm run doc:build:markdown

# Build and serve documentation site
cd src/docs
npm run dev
```

## Reporting Issues

### Using GitHub Issues

When reporting bugs or requesting features, use GitHub issues:

1. Search existing issues first
2. Use issue templates when available
3. Provide clear, descriptive titles
4. Include all relevant information

### Bug Reports

Include:

- **Description**: What happened vs. what you expected
- **Steps to Reproduce**: Minimal code example
- **Environment**: Node.js version, OS, package version
- **Error Messages**: Full error output
- **Screenshots**: If applicable

Example:

```markdown
## Description
Streaming validation fails with array fields.

## Steps to Reproduce
```typescript
const gen = ax('input:string -> items:string[]');
const stream = await gen.streamingForward(ai, { input: 'test' });
// Error occurs here
```

## Environment
- Node.js: v20.10.0
- @ax-llm/ax: v14.0.0
- OS: macOS 14.0

## Error Message
```
TypeError: Cannot read property 'length' of undefined
```
```

### Feature Requests

Include:

- **Use Case**: Why is this feature needed?
- **Proposed Solution**: How should it work?
- **Alternatives**: Other approaches considered
- **Examples**: Code examples of desired API

### Security Vulnerabilities

**Do not open public issues for security vulnerabilities.**

Report security issues privately by following the instructions in [SECURITY.md](../docs/SECURITY.md).

## Community Guidelines

### Code of Conduct

Be respectful and professional:

- Use welcoming and inclusive language
- Respect differing viewpoints
- Accept constructive criticism gracefully
- Focus on what's best for the community
- Show empathy towards others

### Communication Channels

- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: Questions and general discussion
- **Discord**: Real-time chat and community support ([Join here](https://discord.gg/DSHg3dU7dW))
- **Twitter**: Updates and announcements ([@dosco](https://twitter.com/dosco))

### Getting Help

If you need help:

1. Check the [documentation](https://github.com/ax-llm/ax/tree/main/docs)
2. Search existing issues and discussions
3. Ask in Discord for quick questions
4. Open a GitHub discussion for detailed questions

### Asking Good Questions

When asking for help:

- Provide context about what you're trying to achieve
- Include relevant code snippets
- Describe what you've already tried
- Specify your environment (Node.js version, etc.)

## Recognition

### Contributors

All contributors are recognized in:

- GitHub contributors list
- Release notes for significant contributions
- Project README for major features

### Becoming a Maintainer

Active contributors who demonstrate:

- Consistent high-quality contributions
- Good understanding of the codebase
- Helpful community engagement

May be invited to become maintainers.

## Additional Resources

- [Architecture Guide](../docs/ARCHITECTURE.md) - Technical deep dive
- [Quick Start](../docs/QUICKSTART.md) - Get started quickly
- [Examples](../docs/EXAMPLES.md) - Comprehensive examples
- [API Documentation](../docs/API.md) - Complete API reference
- [Discord Community](https://discord.gg/DSHg3dU7dW) - Get help and connect

## Questions?

If you have questions about contributing, feel free to:

- Open a GitHub discussion
- Ask in Discord
- Reach out to maintainers

Thank you for contributing to Ax! 🚀