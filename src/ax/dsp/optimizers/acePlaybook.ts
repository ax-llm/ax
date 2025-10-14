import crypto from 'node:crypto';

import type {
  AxACEBullet,
  AxACECuratorOperation,
  AxACEPlaybook,
} from './aceTypes.js';

interface ApplyOperationsOptions {
  maxSectionSize?: number;
  allowDynamicSections?: boolean;
}

/**
 * Create a fresh, empty playbook structure.
 */
export function createEmptyPlaybook(description?: string): AxACEPlaybook {
  const timestamp = new Date().toISOString();
  return {
    version: 1,
    sections: {},
    stats: {
      bulletCount: 0,
      helpfulCount: 0,
      harmfulCount: 0,
      tokenEstimate: 0,
    },
    updatedAt: timestamp,
    description,
  };
}

/**
 * Produce a deep clone to prevent accidental mutation of stored artifacts.
 */
export function clonePlaybook(
  playbook: Readonly<AxACEPlaybook>
): AxACEPlaybook {
  return JSON.parse(JSON.stringify(playbook)) as AxACEPlaybook;
}

/**
 * Lightweight token estimation based on character count (fallback when tiktoken
 * is unavailable). The constant (4 chars/token) approximates GPT-style tokenizers.
 */
export function estimateTokenCount(text: string): number {
  const avgCharsPerToken = 4;
  return Math.ceil(text.length / avgCharsPerToken);
}

/**
 * Apply curator operations (delta updates) to the playbook in-place.
 * Returns the list of bullet ids that were added or updated for auditing.
 */
export function applyCuratorOperations(
  playbook: AxACEPlaybook,
  operations: readonly AxACECuratorOperation[],
  options?: Readonly<ApplyOperationsOptions>
): { updatedBulletIds: string[] } {
  const updatedBullets: string[] = [];
  const {
    maxSectionSize = Number.POSITIVE_INFINITY,
    allowDynamicSections = true,
  } = options ?? {};

  const now = new Date().toISOString();

  for (const op of operations) {
    if (!op.section) {
      continue;
    }

    if (!playbook.sections[op.section]) {
      if (!allowDynamicSections) {
        continue;
      }
      playbook.sections[op.section] = [];
    }

    const section = playbook.sections[op.section]!;

    switch (op.type) {
      case 'ADD': {
        if (section.length >= maxSectionSize) {
          // Skip addition if exceeding cap; caller may decide to prune first.
          continue;
        }

        const id = op.bulletId ?? generateBulletId(op.section);
        const bullet: AxACEBullet = {
          id,
          section: op.section,
          content: op.content ?? '',
          helpfulCount: 0,
          harmfulCount: 0,
          createdAt: now,
          updatedAt: now,
          metadata: op.metadata ? { ...op.metadata } : undefined,
        };
        section.push(bullet);
        updatedBullets.push(id);
        break;
      }
      case 'UPDATE': {
        const bullet = section.find((b) => b.id === op.bulletId);
        if (!bullet) {
          continue;
        }
        if (typeof op.content === 'string') {
          bullet.content = op.content;
        }
        bullet.updatedAt = now;
        if (op.metadata) {
          bullet.metadata = {
            ...(bullet.metadata ?? {}),
            ...op.metadata,
          };
        }
        updatedBullets.push(bullet.id);
        break;
      }
      case 'REMOVE': {
        const idx = section.findIndex((b) => b.id === op.bulletId);
        if (idx >= 0) {
          const [removed] = section.splice(idx, 1);
          if (removed) {
            updatedBullets.push(removed.id);
          }
        }
        break;
      }
    }
  }

  recomputePlaybookStats(playbook);
  playbook.updatedAt = now;

  return { updatedBulletIds: updatedBullets };
}

/**
 * Increase the helpful/harmful counters reported by the Reflector stage.
 */
export function updateBulletFeedback(
  playbook: AxACEPlaybook,
  bulletId: string,
  tag: 'helpful' | 'harmful' | 'neutral'
): void {
  for (const section of Object.values(playbook.sections)) {
    const bullet = section.find((b) => b.id === bulletId);
    if (bullet) {
      if (tag === 'helpful') {
        bullet.helpfulCount += 1;
      } else if (tag === 'harmful') {
        bullet.harmfulCount += 1;
      }
      bullet.updatedAt = new Date().toISOString();
      recomputePlaybookStats(playbook);
      return;
    }
  }
}

/**
 * Render the playbook into a markdown-like instruction block that can be
 * appended to a system prompt.
 */
export function renderPlaybook(playbook: Readonly<AxACEPlaybook>): string {
  const header = playbook.description
    ? `## Context Playbook\n${playbook.description.trim()}\n`
    : '## Context Playbook\n';

  const sections = Object.entries(playbook.sections)
    .map(([sectionName, bullets]) => {
      const body = bullets
        .map((bullet) => `- [${bullet.id}] ${bullet.content}`)
        .join('\n');
      return body
        ? `### ${sectionName}\n${body}`
        : `### ${sectionName}\n_(empty)_`;
    })
    .join('\n\n');

  return `${header}\n${sections}`.trim();
}

/**
 * Simple deterministic bullet id generator (section prefix + random suffix).
 * Aligns with paper examples like "calc-00001".
 */
export function generateBulletId(section: string): string {
  const normalized = section
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 6);
  const randomHex = crypto.randomBytes(4).toString('hex');
  return `${normalized || 'ctx'}-${randomHex}`;
}

/**
 * Remove duplicate bullets based on cosine similarity of content embeddings.
 * The default implementation uses a naive string comparison fallback so that
 * ACE remains functional without embedding services. Callers can inject a more
 * sophisticated deduper if desired.
 */
export function dedupePlaybookByContent(
  playbook: AxACEPlaybook,
  _similarityThreshold = 0.95
): void {
  for (const [sectionName, bullets] of Object.entries(playbook.sections)) {
    const seen = new Map<string, AxACEBullet>();
    const unique: AxACEBullet[] = [];

    for (const bullet of bullets) {
      const key = bullet.content.trim().toLowerCase();
      const existing = seen.get(key);
      if (existing) {
        // Merge counters if they are near-identical
        existing.helpfulCount += bullet.helpfulCount;
        existing.harmfulCount += bullet.harmfulCount;
        existing.updatedAt = bullet.updatedAt;
      } else {
        seen.set(key, bullet);
        unique.push(bullet);
      }
    }

    playbook.sections[sectionName] = unique;
  }

  recomputePlaybookStats(playbook);
}

function recomputePlaybookStats(playbook: AxACEPlaybook): void {
  let bulletCount = 0;
  let helpfulCount = 0;
  let harmfulCount = 0;
  let tokenEstimate = 0;

  for (const bullets of Object.values(playbook.sections)) {
    for (const bullet of bullets) {
      bulletCount += 1;
      helpfulCount += bullet.helpfulCount;
      harmfulCount += bullet.harmfulCount;
      tokenEstimate += estimateTokenCount(bullet.content);
    }
  }

  playbook.stats = {
    bulletCount,
    helpfulCount,
    harmfulCount,
    tokenEstimate,
  };
}
