#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const ALL_TARGETS = ['python', 'java', 'cpp', 'go', 'rust'];

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const ledgerPath = path.join(repoRoot, 'ir', 'behavioral-parity-ledger.json');
const tsconfigPath = path.join(repoRoot, 'tsconfig.json');

function programForInventory() {
  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (config.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, '\n')
    );
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot);
  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
}

function declarationNamed(program, name, predicate) {
  for (const source of program.getSourceFiles()) {
    if (
      !source.fileName.includes(
        `${path.sep}src${path.sep}ax${path.sep}agent${path.sep}`
      )
    )
      continue;
    for (const statement of source.statements) {
      if (predicate(statement) && statement.name?.text === name)
        return statement;
    }
  }
  throw new Error(`unable to find TypeScript declaration ${name}`);
}

function isPublicDeclaration(declaration) {
  const flags = ts.getCombinedModifierFlags(declaration);
  return (
    (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) === 0
  );
}

function propertiesOfNamedType(program, name) {
  const checker = program.getTypeChecker();
  const declaration = declarationNamed(
    program,
    name,
    (node) => ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)
  );
  return checker
    .getPropertiesOfType(checker.getTypeAtLocation(declaration))
    .map((symbol) => symbol.getName())
    .filter((member) => member !== '__index')
    .sort();
}

function classInventory(program) {
  const declaration = program
    .getSourceFiles()
    .find((source) => source.fileName.endsWith('/agentInternal/coordinator.ts'))
    ?.statements.find(
      (statement) =>
        ts.isClassDeclaration(statement) && statement.name?.text === 'AxAgent'
    );
  if (!declaration || !ts.isClassDeclaration(declaration)) {
    throw new Error('unable to find public AxAgent coordinator class');
  }
  const methods = [];
  const observables = [];
  for (const member of declaration.members) {
    if (!member.name || !isPublicDeclaration(member)) continue;
    const name = member.name.getText().replace(/^['"]|['"]$/g, '');
    if (ts.isConstructorDeclaration(member)) continue;
    if (ts.isMethodDeclaration(member)) methods.push(name);
    else observables.push(name);
  }
  return {
    methods: [...new Set(methods)].sort(),
    observables: [...new Set(observables)].sort(),
  };
}

function contextEventInventory(program) {
  const checker = program.getTypeChecker();
  const declaration = declarationNamed(
    program,
    'AxAgentContextEvent',
    ts.isTypeAliasDeclaration
  );
  const type = checker.getTypeAtLocation(declaration);
  const variants = type.isUnion() ? type.types : [type];
  const out = [];
  for (const variant of variants) {
    const property = checker.getPropertyOfType(variant, 'kind');
    const propertyDeclaration =
      property?.valueDeclaration ?? property?.declarations?.[0];
    if (!propertyDeclaration) continue;
    const value = checker.getTypeOfSymbolAtLocation(
      property,
      propertyDeclaration
    );
    const values = value.isUnion() ? value.types : [value];
    for (const item of values) if (item.isStringLiteral()) out.push(item.value);
  }
  return [...new Set(out)].sort();
}

export function extractAxAgentInventory() {
  const program = programForInventory();
  const ctor = propertiesOfNamedType(program, 'AxAgentConfig').map(
    (member) => `constructor.${member}`
  );
  const forward = propertiesOfNamedType(program, 'AxAgentForwardOptions').map(
    (member) => `forward.${member}`
  );
  const streaming = propertiesOfNamedType(
    program,
    'AxAgentStreamingForwardOptions'
  ).map((member) => `streaming_forward.${member}`);
  const state = propertiesOfNamedType(program, 'AxAgentState').map(
    (member) => `state.${member}`
  );
  const klass = classInventory(program);
  const methods = klass.methods.map((member) => `method.${member}`);
  const observables = klass.observables.map((member) => `observable.${member}`);
  const events = contextEventInventory(program).map(
    (member) => `event.${member}`
  );
  return [
    ...new Set([
      ...ctor,
      ...forward,
      ...streaming,
      ...methods,
      ...observables,
      ...events,
      ...state,
    ]),
  ].sort();
}

function inventoryDigest(inventory) {
  return createHash('sha256')
    .update(`${inventory.join('\n')}\n`)
    .digest('hex');
}

function expandClaims(ledger, inventory, violations) {
  const claims = [...(ledger.axagent_claims ?? [])];
  for (const group of ledger.axagent_claim_groups ?? []) {
    let members = group.members ?? [];
    if (group.member_selector === 'inventory_except') {
      const digest = inventoryDigest(inventory);
      if (group.inventory_sha256 !== digest) {
        violations.push(
          `${group.id ?? 'claim group'}: public inventory changed (expected ${group.inventory_sha256}, got ${digest}); review and refresh the explicit classification snapshot`
        );
      }
      const excluded = new Set(group.except ?? []);
      members = inventory.filter((member) => !excluded.has(member));
    }
    for (const member of members) {
      claims.push({
        ...group,
        member,
        contract_id: `${group.contract_id_prefix}.${member}`,
        option_effect:
          group.option_effects?.[member] ??
          group.option_effect?.replaceAll('{member}', member),
      });
    }
  }
  return claims;
}

function collectIROps() {
  const axcore = path.join(repoRoot, 'ir', 'axcore');
  const out = new Set();
  for (const file of ts.sys.readDirectory(axcore, ['.axir'])) {
    const body = readFileSync(file, 'utf8');
    for (const match of body.matchAll(
      /op\s+[A-Za-z0-9_.]+\s+(@[A-Za-z0-9_]+)/g
    )) {
      out.add(match[1]);
    }
  }
  return out;
}

function fixtureContractIDs(fixture) {
  const ids = [];
  if (typeof fixture.parity_contract_id === 'string')
    ids.push(fixture.parity_contract_id);
  if (Array.isArray(fixture.parity_contract_ids))
    ids.push(...fixture.parity_contract_ids);
  return ids;
}

export function validateAxAgentClaims(
  ledger,
  inventory = extractAxAgentInventory(),
  options = {}
) {
  const violations = [];
  const claims = expandClaims(ledger, inventory, violations);
  const byMember = new Map();
  const contracts = new Map();
  const irOps = collectIROps();
  const backlog = JSON.parse(
    readFileSync(path.join(repoRoot, 'ir', 'axir-backlog.json'), 'utf8')
  );
  const backlogIDs = new Set([
    ...(backlog.entries ?? []).map((entry) => entry.id),
    ...(backlog.nonPortableExemptions ?? []).map((entry) => entry.id),
  ]);

  for (const claim of claims) {
    if (byMember.has(claim.member))
      violations.push(`${claim.member}: duplicate classification`);
    byMember.set(claim.member, claim);
    if (
      !['portable', 'typescript-only', 'target-specific'].includes(
        claim.classification
      )
    ) {
      violations.push(
        `${claim.member}: invalid classification ${claim.classification}`
      );
    }
    if (!claim.rationale?.trim())
      violations.push(`${claim.member}: missing rationale`);
    if (!claim.contract_id?.trim())
      violations.push(`${claim.member}: missing canonical contract_id`);
    else if (
      contracts.has(claim.contract_id) &&
      contracts.get(claim.contract_id) !== claim.member
    ) {
      violations.push(
        `${claim.contract_id}: reused by ${contracts.get(claim.contract_id)} and ${claim.member}`
      );
    } else contracts.set(claim.contract_id, claim.member);

    if (!Array.isArray(claim.required_targets))
      violations.push(`${claim.member}: missing required_targets declaration`);
    if (!Array.isArray(claim.ir_ops))
      violations.push(`${claim.member}: missing AxIR operations declaration`);
    if (!claim.oracle_scenario?.trim())
      violations.push(`${claim.member}: missing TypeScript oracle scenario`);
    if (!Array.isArray(claim.observable_projection))
      violations.push(
        `${claim.member}: missing observable projection declaration`
      );
    if (!claim.option_effect?.trim())
      violations.push(`${claim.member}: missing option-effect assertion`);

    if (claim.classification === 'portable') {
      const missingTargets = ALL_TARGETS.filter(
        (target) => !claim.required_targets?.includes(target)
      );
      if (missingTargets.length)
        violations.push(
          `${claim.member}: portable claim missing targets ${missingTargets.join(', ')}`
        );
      if (!claim.ir_ops?.length)
        violations.push(
          `${claim.member}: portable claim missing AxIR operations`
        );
      for (const op of claim.ir_ops ?? [])
        if (!irOps.has(op))
          violations.push(`${claim.member}: unknown AxIR operation ${op}`);
      if (!claim.observable_projection?.length)
        violations.push(
          `${claim.member}: portable claim missing exact observable projection`
        );
      if (!claim.fixtures?.length)
        violations.push(
          `${claim.member}: portable claim missing oracle fixture`
        );
      let contractFixtureFound = false;
      let contractEffectFound = false;
      for (const relative of claim.fixtures ?? []) {
        const fixturePath = path.join(repoRoot, 'ir', 'conformance', relative);
        if (!existsSync(fixturePath)) {
          violations.push(`${claim.member}: fixture ${relative} not found`);
          continue;
        }
        const fixture =
          options.fixture_overrides?.get(relative) ??
          JSON.parse(readFileSync(fixturePath, 'utf8'));
        if (fixtureContractIDs(fixture).includes(claim.contract_id)) {
          contractFixtureFound = true;
          const effectPath = fixture.option_effects?.[claim.contract_id];
          if (typeof effectPath === 'string' && effectPath.trim()) {
            const projectionKey = effectPath.split('.')[0];
            if (
              !(projectionKey in (fixture.exact_observable_projection ?? {}))
            ) {
              violations.push(
                `${claim.member}: option-effect path ${effectPath} is absent from ${relative}`
              );
            } else {
              contractEffectFound = true;
            }
          }
        }
        if (!fixture.exact_observable_projection)
          violations.push(
            `${claim.member}: fixture ${relative} lacks exact_observable_projection`
          );
        if (!fixture.option_effect)
          violations.push(
            `${claim.member}: fixture ${relative} lacks option_effect`
          );
      }
      if (claim.fixtures?.length && !contractFixtureFound) {
        violations.push(
          `${claim.member}: no configured fixture declares ${claim.contract_id}`
        );
      }
      if (
        claim.fixtures?.length &&
        contractFixtureFound &&
        !contractEffectFound
      ) {
        violations.push(
          `${claim.member}: no oracle fixture declares an exact option-effect path for ${claim.contract_id}`
        );
      }
    } else if (
      !claim.exemption?.reason?.trim() ||
      !claim.exemption?.backlog?.trim()
    ) {
      violations.push(
        `${claim.member}: non-portable classification needs exemption reason and backlog reference`
      );
    } else {
      const backlogID = claim.exemption.backlog.split('#').at(-1);
      if (!backlogIDs.has(backlogID)) {
        violations.push(
          `${claim.member}: exemption backlog reference ${claim.exemption.backlog} does not exist`
        );
      }
    }
  }

  for (const member of inventory)
    if (!byMember.has(member))
      violations.push(`${member}: unclassified public AxAgent member`);
  for (const member of byMember.keys())
    if (!inventory.includes(member))
      violations.push(
        `${member}: stale classification not present in TypeScript public inventory`
      );

  const portableContracts = claims
    .filter((claim) => claim.classification === 'portable')
    .map((claim) => claim.contract_id)
    .sort();
  for (const target of ALL_TARGETS) {
    const coveragePath = path.join(
      repoRoot,
      'packages',
      target,
      'conformance-coverage.json'
    );
    if (!existsSync(coveragePath)) {
      violations.push(
        `${target}: generated conformance coverage manifest missing`
      );
      continue;
    }
    const coverage = JSON.parse(readFileSync(coveragePath, 'utf8'));
    const forward = (coverage.suites?.axagent ?? []).find(
      (entry) => entry.kind === 'agent_forward'
    );
    if (!forward?.runner) {
      violations.push(`${target}: no public agent_forward conformance runner`);
      continue;
    }
    for (const contract of portableContracts) {
      if (!forward.contract_ids?.includes(contract)) {
        violations.push(
          `${target}: agent_forward coverage missing portable contract ${contract}`
        );
      }
    }
  }
  return violations;
}

function runSelfTests(ledger, inventory) {
  const failures = [];
  const portableClaims = expandClaims(ledger, inventory, []).filter(
    (claim) => claim.classification === 'portable'
  );
  const portable =
    portableClaims.find((claim) => claim.member === 'constructor.skills') ??
    portableClaims[0];
  if (!portable)
    return ['self-test requires at least one portable AxAgent claim'];
  const ignoredOptionFixtures = new Map();
  for (const relative of portable.fixtures ?? []) {
    const fixturePath = path.join(repoRoot, 'ir', 'conformance', relative);
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    if (fixtureContractIDs(fixture).includes(portable.contract_id)) {
      const changed = structuredClone(fixture);
      const effectPath = changed.option_effects?.[portable.contract_id];
      if (typeof effectPath === 'string') {
        const projectionKey = effectPath.split('.')[0];
        delete changed.exact_observable_projection?.[projectionKey];
      }
      ignoredOptionFixtures.set(relative, changed);
    }
  }
  if (
    !validateAxAgentClaims(ledger, inventory, {
      fixture_overrides: ignoredOptionFixtures,
    }).some(
      (item) =>
        item.includes('option-effect path') && item.includes('is absent from')
    )
  ) {
    failures.push(
      'ignored-option mutation did not fail after removing its exact observable effect'
    );
  }
  const stale = structuredClone(ledger);
  const changed = stale.axagent_claim_groups.find((candidate) =>
    candidate.members?.includes(portable.member)
  );
  changed.fixtures = ['axagent/does-not-exist.json'];
  if (
    !validateAxAgentClaims(stale, inventory).some((item) =>
      item.includes('not found')
    )
  ) {
    failures.push('stale-fixture mutation did not fail the fixture gate');
  }
  return failures;
}

const inventory = extractAxAgentInventory();
if (process.argv.includes('--print-inventory')) {
  console.log(JSON.stringify(inventory, null, 2));
  process.exit(0);
}
if (process.argv.includes('--print-digest')) {
  console.log(inventoryDigest(inventory));
  process.exit(0);
}
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const violations = validateAxAgentClaims(ledger, inventory);
if (process.argv.includes('--self-test'))
  violations.push(...runSelfTests(ledger, inventory));
if (violations.length) {
  console.error('AxAgent semantic parity gate FAILED:');
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}
console.log(
  `AxAgent semantic parity gate ok: ${inventory.length} public members are classified`
);
