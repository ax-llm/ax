#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const siteRoot = path.join(repoRoot, 'website');
const destination = await mkdtemp(path.join(tmpdir(), 'website-public-'));

try {
  run('npm', ['run', 'doc:build:markdown']);
  run('npm', ['run', 'website:prepare']);
  run('hugo', [
    '--source',
    siteRoot,
    '--environment',
    'production',
    '--destination',
    destination,
    '--cleanDestinationDir',
    '--printPathWarnings',
    '--minify',
  ]);
  run('pagefind', [
    '--site',
    destination,
    '--output-path',
    path.join(destination, 'pagefind'),
    '--include-characters',
    '@/._-+#',
  ]);

  const htmlFiles = (await listFiles(destination)).filter((file) =>
    file.endsWith('.html')
  );
  const failures = [];
  const qualityFailures = [];

  if (!(await exists(path.join(destination, 'pagefind', 'pagefind.js')))) {
    qualityFailures.push('Pagefind index missing pagefind/pagefind.js');
  }

  const css = await readFile(path.join(destination, 'css', 'site.css'), 'utf8');
  const js = await readFile(path.join(destination, 'js', 'site.js'), 'utf8');
  if (
    !css.includes('flex-direction:column') &&
    !css.includes('flex-direction: column')
  ) {
    qualityFailures.push('mobile layout check missing flex-direction: column');
  }
  if (!css.includes('order:2') && !css.includes('order: 2')) {
    qualityFailures.push('mobile layout check missing side-nav order: 2');
  }
  if (!css.includes('overflow-x:auto') && !css.includes('overflow-x: auto')) {
    qualityFailures.push('overflow check missing overflow-x: auto styling');
  }
  if (!/--bg:\s*#ffffff/i.test(css)) {
    qualityFailures.push('light theme background must use --bg: #ffffff');
  }
  if (!css.includes('--font-sans')) {
    qualityFailures.push('Stripe-inspired design tokens missing --font-sans');
  }
  if (css.includes('Inter')) {
    qualityFailures.push('design must use system sans stack, not Inter');
  }
  if (!/--shadow:\s*none\b/.test(css)) {
    qualityFailures.push('normal card shadow token must stay disabled');
  }
  if (!css.includes('--line: #e3e8ee')) {
    qualityFailures.push('polished blue-gray border token missing');
  }
  if (!css.includes('.home-hero-panel')) {
    qualityFailures.push('polished homepage hero panel styles missing');
  }
  if (!css.includes('.home-code-block')) {
    qualityFailures.push('homepage highlighted code panel styles missing');
  }
  if (!/\.chroma\s+\.line\s*\{[^}]*display\s*:\s*block/.test(css)) {
    qualityFailures.push('highlighted code line rows must render as blocks');
  }
  if (
    !/\.chroma\s+\.cl\s*\{[^}]*display\s*:\s*inline\s*[;}]/.test(css) ||
    /\.chroma\s+\.cl\s*\{[^}]*min-width/.test(css)
  ) {
    qualityFailures.push(
      'highlighted code content spans must stay plain inline'
    );
  }
  if (!/pre\s+code\s*\{[^}]*font-size\s*:\s*1em/.test(css)) {
    qualityFailures.push('pre code must neutralize inline-code font scaling');
  }
  if (
    !/\.code-block\s+pre\s*\{[^}]*font-size\s*:\s*0\.875rem/.test(css) ||
    !/\.code-block\s+pre\s*\{[^}]*line-height\s*:\s*1\.5\b/.test(css)
  ) {
    qualityFailures.push('code blocks must use 0.875rem/1.5 code rhythm');
  }
  if (
    !/\.home\s+\.code-block\s+pre\s*\{[^}]*font-size\s*:\s*0\.875rem/.test(
      css
    ) ||
    !/\.home\s+\.code-block\s+pre\s*\{[^}]*line-height\s*:\s*1\.5\b/.test(css)
  ) {
    qualityFailures.push('homepage code blocks must match docs code rhythm');
  }
  if (css.includes('code-line-blank')) {
    qualityFailures.push('blank-line band-aid CSS must stay removed');
  }
  if (js.includes('code-line-blank')) {
    qualityFailures.push('blank-line band-aid JS must stay removed');
  }
  if (!css.includes('.home-visual-grid')) {
    qualityFailures.push('homepage visual story grid styles missing');
  }
  if (!css.includes('.home-capability-grid')) {
    qualityFailures.push('homepage capability grid styles missing');
  }
  if (!css.includes('.home-research-list')) {
    qualityFailures.push('homepage research list styles missing');
  }
  if (!css.includes('.home-research-compact')) {
    qualityFailures.push('homepage compact research density styles missing');
  }
  if (!css.includes('.home-paper-item')) {
    qualityFailures.push('homepage research paper item styles missing');
  }
  if (!css.includes('.paper-logo-mark')) {
    qualityFailures.push('homepage research logo mark styles missing');
  }
  if (
    !css.includes('.paper-logo-arxiv') ||
    !css.includes('#b31b1b') ||
    !css.includes('.paper-logo-arxiv strong')
  ) {
    qualityFailures.push('arXiv mark must use red/white styled text logo');
  }
  if (!css.includes('.home-agent-code')) {
    qualityFailures.push('homepage full-width agent code styles missing');
  }
  if (!css.includes('.home-agent-feature-grid')) {
    qualityFailures.push('homepage agent feature grid styles missing');
  }
  if (!css.includes('.home-agent-code .home-code-block')) {
    qualityFailures.push('homepage agent code dark block styles missing');
  }
  if (!css.includes('.content-standalone')) {
    qualityFailures.push('standalone research page styles missing');
  }
  if (css.includes('home-section-heading-center')) {
    qualityFailures.push('homepage section headings must stay left-aligned');
  }
  if (!css.includes('.home-inline-visual')) {
    qualityFailures.push('homepage inline visual styles missing');
  }
  if (!css.includes('.home-context-chart')) {
    qualityFailures.push('homepage context chart styles missing');
  }
  if (!css.includes('.home-card-icon svg')) {
    qualityFailures.push('homepage inline icon SVG styles missing');
  }
  if (!css.includes('.home-language-pills')) {
    qualityFailures.push('homepage language picker styles missing');
  }
  if (!css.includes('.home-pattern-grid')) {
    qualityFailures.push('homepage pattern grid styles missing');
  }
  if (!css.includes('.home-provider-grid')) {
    qualityFailures.push('homepage provider grid styles missing');
  }
  if (!css.includes('.home-stats')) {
    qualityFailures.push('homepage stats row styles missing');
  }
  if (!css.includes('.language-menu')) {
    qualityFailures.push('prominent language menu styles missing');
  }
  if (!css.includes('.language-mark')) {
    qualityFailures.push('language logo mark styles missing');
  }
  if (!css.includes('.theme-toggle')) {
    qualityFailures.push('icon theme toggle styles missing');
  }
  if (!css.includes('.top-icon-link')) {
    qualityFailures.push('icon-only header link styles missing');
  }
  if (
    css.includes('border-radius: 14px') ||
    css.includes('border-radius:14px')
  ) {
    qualityFailures.push('border radii are too chunky for the docs shell');
  }
  if (!css.includes('.section-nav')) {
    qualityFailures.push('Stripe-inspired section navigation styles missing');
  }
  if (!css.includes('.section-nav-home')) {
    qualityFailures.push('homepage centered section navigation styles missing');
  }
  if (!css.includes('.mobile-docs-nav')) {
    qualityFailures.push('mobile docs drawer styles missing');
  }
  if (!js.includes('data-home-code-panel')) {
    qualityFailures.push('homepage language rotator code panel hook missing');
  }
  if (!js.includes('data-search-scope-toggle')) {
    qualityFailures.push('search scope toggle hook missing');
  }
  if (!js.includes('debouncedSearch')) {
    qualityFailures.push('search must use Pagefind debouncedSearch');
  }
  if (!js.includes('sanitizePagefindHTML')) {
    qualityFailures.push(
      'search must render Pagefind highlighted excerpts safely'
    );
  }
  if (!js.includes('queryLanguageIntent')) {
    qualityFailures.push('search must infer explicit language/package intent');
  }
  if (!js.includes('SEARCH_RESULT_POOL_LIMIT')) {
    qualityFailures.push('search must rerank a widened Pagefind result pool');
  }
  if (!css.includes('.search-result-excerpt mark')) {
    qualityFailures.push('search highlight mark styling missing');
  }
  if (!css.includes('.search-result-badge')) {
    qualityFailures.push('search result badge styling missing');
  }
  if (!css.includes('.search-result-kind')) {
    qualityFailures.push('search result kind badge styling missing');
  }
  if (!js.includes('SEARCH_ANCHOR_DISPLAY_LIMIT')) {
    qualityFailures.push(
      'search must group section anchors under page results'
    );
  }
  if (!js.includes('data-search-more')) {
    qualityFailures.push('search show-more control hook missing');
  }
  if (!js.includes('warmSearch')) {
    qualityFailures.push('search index warm-up on intent missing');
  }
  if (!js.includes('data-site-menu')) {
    qualityFailures.push('mobile site menu hook missing');
  }
  if (!css.includes('.search-result-anchor')) {
    qualityFailures.push('grouped search anchor styles missing');
  }
  if (!css.includes('.search-more')) {
    qualityFailures.push('search show-more styles missing');
  }
  if (!css.includes('.site-menu-panel')) {
    qualityFailures.push('mobile site menu panel styles missing');
  }
  if (!css.includes('.menu-toggle-icon')) {
    qualityFailures.push('hamburger icon styles missing');
  }
  if (!css.includes('.nav-fade-right')) {
    qualityFailures.push('section nav scroll fade styles missing');
  }
  if (!js.includes('prefers-reduced-motion: reduce')) {
    qualityFailures.push(
      'homepage language rotator must respect reduced motion'
    );
  }
  if (!js.includes('HOME_LANGUAGE_ROTATION_MS = 12000')) {
    qualityFailures.push('homepage language rotation interval must be 12000ms');
  }
  if (!js.includes('pickNextHomeHeroExample')) {
    qualityFailures.push('homepage hero code must rotate example types');
  }
  if (
    !js.includes('HOME_LANGUAGE_FADE_OUT_MS = 260') ||
    !js.includes('HOME_LANGUAGE_FADE_IN_MS = 520')
  ) {
    qualityFailures.push('homepage language rotator fade timings missing');
  }
  if (
    !js.includes('homeLanguageQueued') ||
    !js.includes('freezeHomeLanguageLayout') ||
    !js.includes('animateHomeLanguageLayout') ||
    !js.includes('homeLanguageTransition')
  ) {
    qualityFailures.push(
      'homepage language rotator transition-state guard missing'
    );
  }
  if (!js.includes('document.startViewTransition')) {
    qualityFailures.push(
      'homepage language rotator must progressively use View Transitions'
    );
  }
  if (
    !js.includes('setHomeVariantActive') ||
    (!js.includes('homeActive') && !js.includes('data-home-active'))
  ) {
    qualityFailures.push(
      'homepage language rotator must use stable active state, not hidden swaps'
    );
  }
  if (
    js.includes('panel.hidden') ||
    js.includes('text.hidden') ||
    js.includes('output.hidden')
  ) {
    qualityFailures.push(
      'homepage language rotator must not animate by toggling hidden panels'
    );
  }
  if (!js.includes('stopHomeLanguageRotation')) {
    qualityFailures.push('homepage manual language pause hook missing');
  }
  await collectGradientTokenFailures(qualityFailures);
  await collectSVGCanvasFrameFailures(qualityFailures);
  await collectSVGTextClutterFailures(qualityFailures);

  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8');
    const rel = path.relative(destination, file).replaceAll(path.sep, '/');
    for (const ref of localRefs(html)) {
      const target = resolveRef(file, ref);
      if (!target) continue;
      if (!(await exists(target))) {
        failures.push(
          `${path.relative(destination, file)} -> ${ref} (${path.relative(destination, target)})`
        );
      }
    }
    collectQualityFailures(rel, html, qualityFailures);
  }

  await collectSkillPageFailures(destination, qualityFailures);

  if (failures.length > 0) {
    console.error('website local link check failed:');
    for (const failure of failures.slice(0, 80)) {
      console.error(`- ${failure}`);
    }
    if (failures.length > 80) {
      console.error(`- ...and ${failures.length - 80} more`);
    }
    process.exit(1);
  }

  if (qualityFailures.length > 0) {
    console.error('website quality check failed:');
    for (const failure of qualityFailures.slice(0, 100)) {
      console.error(`- ${failure}`);
    }
    if (qualityFailures.length > 100) {
      console.error(`- ...and ${qualityFailures.length - 100} more`);
    }
    process.exit(1);
  }

  console.log(
    `website link and quality checks passed (${htmlFiles.length} HTML files).`
  );
} finally {
  await rm(destination, { recursive: true, force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    if (result.error.code === 'ENOENT' && command === 'hugo') {
      console.error(
        'Hugo is required for website checks. Install Hugo v0.162.0 or run in CI.'
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function localRefs(html) {
  const refs = [];
  const regex = /\s(?:href|src)="([^"]+)"/g;
  for (const match of html.matchAll(regex)) {
    const ref = match[1];
    if (
      ref.startsWith('http://') ||
      ref.startsWith('https://') ||
      ref.startsWith('mailto:') ||
      ref.startsWith('tel:') ||
      ref.startsWith('data:') ||
      ref.startsWith('javascript:') ||
      ref.startsWith('#')
    ) {
      continue;
    }
    refs.push(ref);
  }
  return refs;
}

function resolveRef(fromFile, ref) {
  const [withoutHash] = ref.split('#');
  const [withoutQuery] = withoutHash.split('?');
  const pathname = decodeURIComponent(withoutQuery);
  if (pathname === '/') return path.join(destination, 'index.html');

  let target = ref.startsWith('/')
    ? path.join(destination, pathname)
    : path.resolve(path.dirname(fromFile), pathname);

  if (path.extname(target) === '') {
    target = path.join(target, 'index.html');
  }
  return target;
}

function collectQualityFailures(rel, html, failures) {
  if (html.includes('livereload.js')) {
    failures.push(`${rel}: production build must not include Hugo livereload`);
  }
  if (!hasAttributeValue(html, 'meta', 'name', 'description', 'content')) {
    failures.push(`${rel}: missing non-empty meta description`);
  }
  if (!html.includes('data-pagefind-body')) {
    failures.push(`${rel}: missing data-pagefind-body`);
  }
  if (!html.includes('data-site-search')) {
    failures.push(`${rel}: missing header search UI`);
  }
  if (!html.includes('search-shortcut')) {
    failures.push(`${rel}: missing slash search shortcut hint`);
  }
  if (!html.includes('data-search-scope-toggle')) {
    failures.push(`${rel}: missing search scope toggle`);
  }
  if (!html.includes('aria-activedescendant')) {
    failures.push(`${rel}: missing search active-descendant wiring`);
  }
  if (!hasAttrValue(html, 'data-pagefind-meta', 'language')) {
    failures.push(`${rel}: missing Pagefind language metadata`);
  }
  if (!hasAttrValue(html, 'data-pagefind-filter', 'language')) {
    failures.push(`${rel}: missing Pagefind language filter`);
  }
  if (!hasAttrValue(html, 'data-pagefind-meta', 'section')) {
    failures.push(`${rel}: missing Pagefind section metadata`);
  }
  if (!hasAttrValue(html, 'data-pagefind-meta', 'slug')) {
    failures.push(`${rel}: missing Pagefind slug metadata`);
  }
  if (!hasAttrValue(html, 'data-pagefind-meta', 'source')) {
    failures.push(`${rel}: missing Pagefind source metadata`);
  }
  if (!hasAttrValue(html, 'data-pagefind-meta', 'kind')) {
    failures.push(`${rel}: missing Pagefind kind metadata`);
  }
  if (!hasAttrValue(html, 'data-pagefind-filter', 'kind')) {
    failures.push(`${rel}: missing Pagefind kind filter`);
  }
  if (!hasAttrValue(html, 'data-pagefind-meta', 'symbol')) {
    failures.push(`${rel}: missing Pagefind symbol metadata`);
  }
  if (!html.includes('data-language-menu')) {
    failures.push(`${rel}: missing prominent language menu`);
  }
  if (!html.includes('data-menu-toggle')) {
    failures.push(`${rel}: missing mobile menu toggle`);
  }
  if (!html.includes('css/site.css?v=')) {
    failures.push(`${rel}: stylesheet missing cache-busting version query`);
  }
  if (!html.includes('data-site-menu')) {
    failures.push(`${rel}: missing mobile site menu`);
  }
  if (!html.includes('language-mark')) {
    failures.push(`${rel}: missing language logo mark`);
  }
  if (!html.includes('data-theme-toggle')) {
    failures.push(`${rel}: missing cycling icon theme toggle`);
  }
  if (!html.includes('top-icon-link')) {
    failures.push(`${rel}: missing icon-only GitHub link`);
  }
  if (html.includes('brand-docs')) {
    failures.push(`${rel}: brand should render as ax, not ax docs`);
  }
  if (rel === 'index.html' && !hasClass(html, 'nav', 'section-nav-home')) {
    failures.push(`${rel}: home page section navigation must be centered`);
  }

  const codeBlocks = countOccurrences(html, 'data-code-block');
  const copyButtons = countOccurrences(html, 'data-copy-code');
  if (codeBlocks !== copyButtons) {
    failures.push(
      `${rel}: code block/copy button mismatch (${codeBlocks}/${copyButtons})`
    );
  }

  if (/\n[ \t]+<\/span><\/span>/.test(html)) {
    failures.push(
      `${rel}: chroma line spans contain injected indentation (shortcode call sites must start at column 0)`
    );
  }
  if (rel === 'index.html' && /\n[ \t]+<\/code><\/pre>/.test(html)) {
    failures.push(
      `${rel}: home output panel pre content has injected indentation`
    );
  }

  const hasMermaidBlock = /<pre[^>]*class="?mermaid["\s>]/.test(html);
  if (hasMermaidBlock && !html.includes('mermaid-init.js')) {
    failures.push(`${rel}: Mermaid block without mermaid-init.js`);
  }
  if (isMermaidExpectedPage(rel) && !hasMermaidBlock) {
    failures.push(`${rel}: expected Mermaid diagram missing`);
  }

  if (isCuratedApiPage(rel)) {
    if (!html.includes('Most Used')) {
      failures.push(`${rel}: API page missing Most Used section`);
    }
    if (!hasClass(html, 'section', 'api-card')) {
      failures.push(`${rel}: API page missing API cards`);
    }
  }

  if (isApiPage(rel) && hasClass(html, 'nav', 'page-toc')) {
    failures.push(`${rel}: API pages must not render page table of contents`);
  }
  if (hasInlinePageToc(html)) {
    failures.push(`${rel}: page table of contents must render outside main`);
  }

  if (isTocExpectedPage(rel) && countOccurrences(html, '<h2 ') >= 5) {
    if (!hasClass(html, 'nav', 'page-toc')) {
      failures.push(`${rel}: long docs page missing page table of contents`);
    }
  }

  // Redirect stubs (moved URLs) are not docs pages; they only need the
  // meta refresh that baseof emits for redirect_to. The minifier may strip
  // attribute quotes, so match both forms.
  const isRedirectStub = /http-equiv=["']?refresh/.test(html);
  if (isLanguageDocsPage(rel) && !isRedirectStub) {
    if (!hasClass(html, 'nav', 'section-nav')) {
      failures.push(`${rel}: missing top section navigation`);
    }
    if (!hasActiveSectionNav(html)) {
      failures.push(`${rel}: top section navigation missing active state`);
    }
    if (!html.includes('>Skills</a>')) {
      failures.push(`${rel}: missing Skills top section navigation link`);
    }
    if (!html.includes('data-mobile-docs')) {
      failures.push(`${rel}: missing mobile docs drawer`);
    }
  }

  if (rel.endsWith('/examples/index.html') && html.includes('example-card')) {
    failures.push(`${rel}: examples landing must use plain markdown lists`);
  }
  if (rel.endsWith('/examples/index.html') && /archive/i.test(html)) {
    failures.push(`${rel}: examples landing must not use archive wording`);
  }
  if (
    /\/examples\/(?:generation|short-agents|flows|optimization|audio)\/index\.html$/.test(
      rel
    ) &&
    !html.includes('Level:')
  ) {
    failures.push(`${rel}: generated example group page missing levels`);
  }

  if (
    html.includes('Generated-package equivalent') &&
    !html.includes('data-snippet-label')
  ) {
    failures.push(`${rel}: generated-language snippet lacks visible label`);
  }

  if (!rel.includes('/api/reference/') && hasDeprecatedAxAIUsage(html)) {
    failures.push(`${rel}: deprecated new AxAI pattern in reader-facing docs`);
  }

  if (rel === 'index.html' && !html.includes('site-search')) {
    failures.push(`${rel}: search UI missing from homepage`);
  }
  if (rel === 'index.html') {
    const heroMatch = html.match(
      /<section\b[^>]*\bclass=(?:"[^"]*\bhome-hero\b[^"]*"|[^\s>]*\bhome-hero\b[^\s>]*)[\s\S]*?<\/section>/i
    );
    const firstFold = heroMatch?.[0] ?? html.slice(0, 8000);
    if (html.includes('home-section-heading-center')) {
      failures.push(`${rel}: homepage section headings must stay left-aligned`);
    }
    if (
      !/<h1[^>]*>[\s\S]*?Stop prompting\.[\s\S]*?Start programming\.[\s\S]*?<\/h1>/.test(
        html
      )
    ) {
      failures.push(
        `${rel}: homepage h1 missing programming-not-prompting hero hook`
      );
    }
    if (
      !/<span[^>]*\bhome-h1-line\b[^>]*>Stop prompting\.<\/span>/.test(html)
    ) {
      failures.push(
        `${rel}: homepage h1 sentences must sit on their own lines (home-h1-line)`
      );
    }
    if (html.includes('The universal way to build with LLMs')) {
      failures.push(`${rel}: homepage still has abstract universal hero`);
    }
    if (!html.includes('hands back typed data')) {
      failures.push(`${rel}: homepage missing newcomer lede`);
    }
    if (!hasClass(html, 'div', 'home-proof-row')) {
      failures.push(`${rel}: homepage missing proof points`);
    }
    for (const proof of [
      'Typed, validated outputs',
      'Agents on any model',
      'RLM research inside',
      'Native in your language',
    ]) {
      if (!firstFold.includes(proof)) {
        failures.push(`${rel}: homepage first fold missing ${proof}`);
      }
    }
    if (!hasClass(html, 'div', 'home-language-bar')) {
      failures.push(`${rel}: homepage missing sticky language bar`);
    }
    if (!hasClass(html, 'div', 'home-proof-strip')) {
      failures.push(`${rel}: homepage missing six-wide proof strip`);
    }
    if (!hasClass(html, 'div', 'home-example-tabs')) {
      failures.push(`${rel}: homepage missing hero example tabs`);
    }
    if (!/data-home-example="?agent"?[\s>]/.test(firstFold)) {
      failures.push(`${rel}: homepage hero missing agent example rotation`);
    }
    for (const forbidden of [
      '15+ LLM providers',
      'DSPy + GEPA optimizer',
      'RLM agent runtime',
    ]) {
      if (firstFold.includes(forbidden)) {
        failures.push(
          `${rel}: homepage first fold still contains expert proof text ${forbidden}`
        );
      }
    }
    if (!hasClass(html, 'div', 'home-agent-strip')) {
      failures.push(`${rel}: homepage missing coding-agent strip`);
    }
    if (
      !html.includes('npx skills add https://ax-llm.github.io/ax/typescript/')
    ) {
      failures.push(`${rel}: homepage missing agent skills install command`);
    }
    if (!html.includes('data-home-stats')) {
      failures.push(`${rel}: homepage missing live project stats row`);
    }
    if (!html.includes('home-install-status')) {
      failures.push(`${rel}: homepage install commands missing status labels`);
    }
    if (!hasClass(html, 'section', 'home-final-cta')) {
      failures.push(`${rel}: homepage missing final call to action`);
    }
    for (const stale of ['./gradlew test', 'com.axllm']) {
      if (html.includes(stale)) {
        failures.push(`${rel}: homepage contains stale package text ${stale}`);
      }
    }
    if (!html.includes('data-home-language-root')) {
      failures.push(`${rel}: homepage missing language rotator root`);
    }
    if (!html.includes('data-home-lang-text')) {
      failures.push(`${rel}: homepage missing rotating install commands`);
    }
    if (!hasClass(html, 'div', 'home-language-pills')) {
      failures.push(`${rel}: homepage missing language selector pills`);
    }
    if (!hasClass(html, 'div', 'home-hero-panel')) {
      failures.push(`${rel}: homepage missing polished hero panel`);
    }
    const researchIndex = html.indexOf('home-research-section');
    const capabilityIndex = html.indexOf('home-capability-grid');
    if (
      researchIndex < 0 ||
      capabilityIndex < 0 ||
      researchIndex > capabilityIndex
    ) {
      failures.push(
        `${rel}: homepage research section must appear before capabilities`
      );
    }
    if (!hasClass(html, 'div', 'home-capability-grid')) {
      failures.push(`${rel}: homepage missing capability grid`);
    }
    if (countOccurrences(html, 'home-marketing-card') < 19) {
      failures.push(`${rel}: homepage missing capability/production cards`);
    }
    for (const capability of [
      'Structured generation',
      'Signatures',
      'Tools and MCP',
      'Agents',
      'Audio',
      'Workflows',
      'Optimization',
      'Providers',
      'Telemetry',
      'Native packages',
    ]) {
      if (!html.includes(capability)) {
        failures.push(`${rel}: homepage missing capability ${capability}`);
      }
    }
    if (!hasClass(html, 'section', 'home-audio-section')) {
      failures.push(`${rel}: homepage missing first-class audio section`);
    }
    for (const audioTerm of [
      'ai.transcribe',
      'ai.speak',
      'speech:audio',
      '.chat()',
      'realtime audio',
    ]) {
      if (!html.includes(audioTerm)) {
        failures.push(`${rel}: homepage missing audio surface ${audioTerm}`);
      }
    }
    if (!hasClass(html, 'section', 'home-research-section')) {
      failures.push(`${rel}: homepage missing research section`);
    }
    if (!html.includes('Built on DSPy, GEPA, ACE, RLM, and PEEK')) {
      failures.push(`${rel}: homepage missing new research title`);
    }
    if (!hasClass(html, 'div', 'home-research-list')) {
      failures.push(`${rel}: homepage research must use vertical list`);
    }
    if (!hasClass(html, 'div', 'home-research-compact')) {
      failures.push(`${rel}: homepage research must use compact density class`);
    }
    if (html.includes('home-research-grid')) {
      failures.push(`${rel}: homepage research must not use grid cards`);
    }
    if (countOccurrences(html, 'home-paper-item') < 5) {
      failures.push(`${rel}: homepage research missing vertical paper items`);
    }
    for (const logoClass of [
      'paper-logo-arxiv',
      'paper-logo-stanford',
      'paper-logo-mit',
      'paper-logo-berkeley',
    ]) {
      if (!html.includes(logoClass)) {
        failures.push(
          `${rel}: homepage missing research logo class ${logoClass}`
        );
      }
    }
    for (const paper of [
      'https://arxiv.org/abs/2310.03714',
      'https://arxiv.org/abs/2312.13382',
      'https://arxiv.org/abs/2507.19457',
      'https://arxiv.org/abs/2512.24601',
      'https://arxiv.org/abs/2605.19932',
    ]) {
      if (!html.includes(paper)) {
        failures.push(`${rel}: homepage missing research link ${paper}`);
      }
    }
    for (const arxivLabel of [
      'arXiv 2310.03714',
      'arXiv 2312.13382',
      'arXiv 2507.19457',
      'arXiv 2512.24601',
      'arXiv 2605.19932',
    ]) {
      if (!html.includes(arxivLabel)) {
        failures.push(`${rel}: homepage missing visible ${arxivLabel} link`);
      }
    }
    if (!hasStyledArxivMark(html)) {
      failures.push(`${rel}: homepage arXiv marks must use styled logo text`);
    }
    for (const researchTerm of [
      'DSPy',
      'GEPA',
      'Recursive Language Models',
      'PEEK',
    ]) {
      if (!html.includes(researchTerm)) {
        failures.push(`${rel}: homepage missing research term ${researchTerm}`);
      }
    }
    for (const svg of [
      'signature-runtime',
      'semantic-network',
      'axir-compiler',
      'language-matrix',
      'rlm-loop',
      'agent-tree',
      'context-growth',
      'pareto-frontier',
      'production-loop',
      'mcp-bridge',
      'provider-router',
    ]) {
      if (!html.includes(`/svg/${svg}.svg`)) {
        failures.push(`${rel}: homepage missing static SVG ${svg}`);
      }
    }
    if (countOccurrences(html, '<span class="home-card-icon') < 14) {
      failures.push(`${rel}: homepage production/pattern cards need SVG icons`);
    }
    if (!hasClass(html, 'figure', 'home-code-block')) {
      failures.push(`${rel}: homepage missing highlighted code panels`);
    }
    if (countOccurrences(html, 'data-home-code-panel') < 78) {
      failures.push(
        `${rel}: homepage missing multilingual rotating code variants`
      );
    }
    const heroPanelCount = (
      html.match(/data-home-code-group=(?:"hero"|hero[\s>])/g) ?? []
    ).length;
    if (heroPanelCount < 7) {
      failures.push(
        `${rel}: homepage hero missing per-language classifier panels`
      );
    }
    if (!hasClass(html, 'div', 'home-output-panel')) {
      failures.push(`${rel}: homepage hero missing typed output panel`);
    }
    if (countOccurrences(html, 'data-home-language=') < 6) {
      failures.push(`${rel}: homepage missing language selection buttons`);
    }
    if (!hasClass(html, 'div', 'home-signature-grid')) {
      failures.push(`${rel}: homepage missing signature story cards`);
    }
    if (!hasClass(html, 'section', 'home-compiler-section')) {
      failures.push(`${rel}: homepage missing AxIR compiler section`);
    }
    for (const oldCompilerText of [
      'One signature, native code',
      'String signatures, fluent builders, and schema output share the same semantics.',
      'One IR, native packages, checked semantics.',
    ]) {
      if (html.includes(oldCompilerText)) {
        failures.push(`${rel}: homepage still has confusing compiler title`);
      }
    }
    for (const compilerTerm of [
      'AxIR compiler',
      "We didn't port Ax six times. We compiled it.",
      'portable intermediate representation',
      'TypeScript is the reference runtime',
      'native package surfaces',
      'axir verify',
    ]) {
      if (!html.includes(compilerTerm)) {
        failures.push(
          `${rel}: homepage compiler section missing ${compilerTerm}`
        );
      }
    }
    if (html.includes('Prompt strings are glue. Signatures are contracts.')) {
      failures.push(`${rel}: homepage still has confusing signature title`);
    }
    if (
      !html.includes(
        'Describe the input and output. Ax handles the model call.'
      )
    ) {
      failures.push(`${rel}: homepage missing clear signature title`);
    }
    if (!hasClass(html, 'section', 'home-agent-section')) {
      failures.push(`${rel}: homepage missing agent/RLM section`);
    }
    if (!hasClass(html, 'div', 'home-agent-code')) {
      failures.push(`${rel}: homepage missing full-width agent code block`);
    }
    if (!hasClass(html, 'div', 'home-agent-feature-grid')) {
      failures.push(`${rel}: homepage missing agent feature grid`);
    }
    const agentCodeIndex = html.indexOf('home-agent-code');
    const rlmSvgIndex = html.indexOf('/svg/rlm-loop.svg');
    if (agentCodeIndex < 0 || rlmSvgIndex < 0 || agentCodeIndex > rlmSvgIndex) {
      failures.push(
        `${rel}: homepage agent code must appear before RLM graphic`
      );
    }
    for (const agentTerm of [
      'DSPy',
      'RLM',
      'PEEK',
      'context management',
      'built-in memory',
      'skills',
      'typed signatures',
      'computes on your data instead of reading it',
      'grounded-audit example',
      'Long-horizon',
      'agent.optimize',
    ]) {
      if (!html.includes(agentTerm)) {
        failures.push(`${rel}: homepage agent section missing ${agentTerm}`);
      }
    }
    for (const feature of [
      'Discovery',
      'Context maps',
      'Memory + skills',
      'Optimization',
    ]) {
      if (!html.includes(feature)) {
        failures.push(`${rel}: homepage agent feature missing ${feature}`);
      }
    }
    if (!hasClass(html, 'div', 'home-stats')) {
      failures.push(`${rel}: homepage missing production stats`);
    }
    if (!hasClass(html, 'div', 'home-pattern-grid')) {
      failures.push(`${rel}: homepage missing signature pattern cards`);
    }
    if (!hasClass(html, 'div', 'home-provider-layout')) {
      failures.push(`${rel}: homepage missing provider/type section`);
    }
    if (!hasClass(html, 'section', 'home-model-section')) {
      failures.push(
        `${rel}: homepage missing simplified model/provider section`
      );
    }
    if (!hasClass(html, 'div', 'home-provider-strip')) {
      failures.push(
        `${rel}: homepage provider section missing simple provider strip`
      );
    }
    if (html.includes('One interface, every LLM.')) {
      failures.push(`${rel}: homepage still has complex provider title`);
    }
    if (html.includes('Rich type system')) {
      failures.push(
        `${rel}: homepage provider section still includes type table`
      );
    }
    for (const providerTerm of [
      'Use any model.',
      'OpenAI-compatible',
      'Need routing, embeddings, audio, or context caching?',
    ]) {
      if (!html.includes(providerTerm)) {
        failures.push(
          `${rel}: homepage provider section missing ${providerTerm}`
        );
      }
    }
    if (!hasClass(html, 'section', 'home-graphjin')) {
      failures.push(`${rel}: homepage missing GraphJin cross-promo`);
    }
    const codeStoryIndex = html.indexOf('home-code-story');
    const compilerIndex = html.indexOf('home-compiler-section');
    const agentIndex = html.indexOf('home-agent-section');
    const graphjinIndex = html.indexOf('home-graphjin');
    const finalCtaIndex = html.indexOf('home-final-cta');
    if (
      codeStoryIndex < 0 ||
      compilerIndex < 0 ||
      agentIndex < 0 ||
      codeStoryIndex > compilerIndex ||
      compilerIndex > researchIndex ||
      researchIndex > agentIndex
    ) {
      failures.push(
        `${rel}: homepage must order signatures, compiler, research, then agents`
      );
    }
    if (
      graphjinIndex < 0 ||
      finalCtaIndex < 0 ||
      graphjinIndex > finalCtaIndex
    ) {
      failures.push(
        `${rel}: homepage final CTA must close the page after GraphJin`
      );
    }
    if (countOccurrences(html, 'language-mark-') < 6) {
      failures.push(`${rel}: homepage missing language logo marks`);
    }
  }

  if (rel === 'research/index.html') {
    if (!html.includes('Research Map')) {
      failures.push(`${rel}: research page missing title`);
    }
    if (!hasClass(html, 'div', 'home-research-list')) {
      failures.push(`${rel}: research page must use vertical paper list`);
    }
    if (countOccurrences(html, 'home-paper-item') < 5) {
      failures.push(`${rel}: research page missing paper items`);
    }
    for (const paper of [
      'https://arxiv.org/abs/2310.03714',
      'https://arxiv.org/abs/2312.13382',
      'https://arxiv.org/abs/2507.19457',
      'https://arxiv.org/abs/2512.24601',
      'https://arxiv.org/abs/2605.19932',
    ]) {
      if (!html.includes(paper)) {
        failures.push(`${rel}: research page missing research link ${paper}`);
      }
    }
    for (const arxivLabel of [
      'arXiv 2310.03714',
      'arXiv 2312.13382',
      'arXiv 2507.19457',
      'arXiv 2512.24601',
      'arXiv 2605.19932',
    ]) {
      if (!html.includes(arxivLabel)) {
        failures.push(
          `${rel}: research page missing visible ${arxivLabel} link`
        );
      }
    }
    for (const badge of ['arXiv', 'Stanford', 'MIT', 'Berkeley']) {
      if (!html.includes(badge)) {
        failures.push(`${rel}: research page missing badge ${badge}`);
      }
    }
    if (!hasStyledArxivMark(html)) {
      failures.push(
        `${rel}: research page arXiv marks must use styled logo text`
      );
    }
    for (const logoClass of [
      'paper-logo-arxiv',
      'paper-logo-stanford',
      'paper-logo-mit',
      'paper-logo-berkeley',
    ]) {
      if (!html.includes(logoClass)) {
        failures.push(`${rel}: research page missing logo class ${logoClass}`);
      }
    }
  }
}

async function collectSkillPageFailures(destination, failures) {
  const languages = ['typescript', 'python', 'java', 'cpp', 'go', 'rust'];
  for (const language of languages) {
    const indexPath = path.join(
      destination,
      language,
      '.well-known',
      'agent-skills',
      'index.json'
    );
    if (!(await exists(indexPath))) {
      failures.push(`${language}: missing agent-skills index`);
      continue;
    }

    const catalog = JSON.parse(await readFile(indexPath, 'utf8'));
    const skills = Array.isArray(catalog.skills) ? catalog.skills : [];
    if (skills.length === 0) {
      failures.push(`${language}: agent-skills index has no skills`);
      continue;
    }

    for (const skill of skills) {
      const pagePath = path.join(
        destination,
        language,
        'skills',
        slugify(skill.name),
        'index.html'
      );
      if (!(await exists(pagePath))) {
        failures.push(`${language}: missing docs page for skill ${skill.name}`);
      }
    }
  }
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function isCuratedApiPage(rel) {
  return /^(?:typescript|python|java|cpp|go|rust)\/api\/(?:ai|ax|s|agent|optimize)\/index\.html$/.test(
    rel
  );
}

function isApiPage(rel) {
  return /^(?:typescript|python|java|cpp|go|rust)\/api\//.test(rel);
}

function isTocExpectedPage(rel) {
  return /^(?:typescript|python|java|cpp|go|rust)\/(?:quick-start|advanced-start|examples(?:\/[^/]+)?|concepts\/[^/]+|subsystems\/[^/]+)\/index\.html$/.test(
    rel
  );
}

function isMermaidExpectedPage(rel) {
  return /^(?:typescript|python|java|cpp|go|rust)\/(?:quick-start|agents(?:\/(?:standard|long-horizon|internals))?|concepts\/(?:dspy|signatures|tools|llms|mcp|optimization|telemetry)|subsystems\/(?:ai|ax|s|optimize))\/index\.html$/.test(
    rel
  );
}

function isLanguageDocsPage(rel) {
  return /^(?:typescript|python|java|cpp|go|rust)\/.+\/index\.html$/.test(rel);
}

function hasInlinePageToc(html) {
  const mainMatch = html.match(/<main\b[\s\S]*?<\/main>/i);
  if (!mainMatch) return false;
  return hasClass(mainMatch[0], 'nav', 'page-toc');
}

function hasActiveSectionNav(html) {
  const navRegex =
    /<nav\b[^>]*\bclass\s*=\s*(?:"[^"]*\bsection-nav\b[^"]*"|'[^']*\bsection-nav\b[^']*'|[^\s>]*\bsection-nav\b[^\s>]*)[^>]*>[\s\S]*?<\/nav>/gi;
  for (const match of html.matchAll(navRegex)) {
    if (hasClass(match[0], 'a', 'active')) return true;
  }
  return false;
}

function hasDeprecatedAxAIUsage(html) {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const withoutGuardrails = text.replace(
    /\b(?:not|avoid|deprecated|do not use|prefer [^.]+ instead of)\s+new\s+AxAI\s*\(/gi,
    ''
  );
  return /\bnew\s+AxAI\s*\(/.test(withoutGuardrails);
}

function hasStyledArxivMark(html) {
  return /<span\b[^>]*\bclass=(?:"[^"]*\bpaper-logo-arxiv\b[^"]*"|'[^']*\bpaper-logo-arxiv\b[^']*'|[^\s>]*\bpaper-logo-arxiv\b[^\s>]*)[^>]*\baria-label=(?:"arXiv"|'arXiv'|arXiv)[^>]*>[\s\S]*?<strong>\s*X\s*<\/strong>/i.test(
    html
  );
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function hasAttributeValue(html, tag, attr, value, requiredAttr) {
  const tagRegex = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  for (const match of html.matchAll(tagRegex)) {
    const tagSource = match[0];
    if (
      attrValue(tagSource, attr) === value &&
      (!requiredAttr || Boolean(attrValue(tagSource, requiredAttr)))
    ) {
      return true;
    }
  }
  return false;
}

function hasClass(html, tag, className) {
  const tagRegex = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  for (const match of html.matchAll(tagRegex)) {
    const classes = attrValue(match[0], 'class')?.split(/\s+/) ?? [];
    if (classes.includes(className)) return true;
  }
  return false;
}

function attrValue(tagSource, attr) {
  const match = tagSource.match(
    new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function hasAttrValue(html, attr, value) {
  const escapedAttr = escapeRegExp(attr);
  const escapedValue = escapeRegExp(value);
  const regex = new RegExp(
    `\\b${escapedAttr}\\s*=\\s*(?:"${escapedValue}"|'${escapedValue}'|${escapedValue})(?=[\\s>/])`,
    'i'
  );
  return regex.test(html);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listFiles(root) {
  const out = [];
  await visit(root);
  return out;

  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(abs);
      if (entry.isFile()) out.push(abs);
    }
  }
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function collectGradientTokenFailures(failures) {
  const tokens = [
    'linear-gradient',
    'radial-gradient',
    'linearGradient',
    'radialGradient',
  ];
  const roots = [
    path.join(siteRoot, 'static', 'css'),
    path.join(siteRoot, 'static', 'svg'),
  ];

  for (const root of roots) {
    if (!(await exists(root))) continue;
    const files = await listFiles(root);
    for (const file of files) {
      if (!/\.(?:css|svg)$/i.test(file)) continue;
      const source = await readFile(file, 'utf8');
      for (const token of tokens) {
        if (source.includes(token)) {
          failures.push(
            `${path.relative(repoRoot, file)}: forbidden gradient token ${token}`
          );
        }
      }
    }
  }
}

async function collectSVGCanvasFrameFailures(failures) {
  const root = path.join(siteRoot, 'static', 'svg');
  if (!(await exists(root))) return;

  const files = (await listFiles(root)).filter((file) => file.endsWith('.svg'));
  const fullCanvasRoundedRect =
    /<rect\b(?=[^>]*\bwidth=["'](?:980|100%)["'])(?=[^>]*\bheight=["'](?:420|100%)["'])(?=[^>]*\brx=)/i;

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (fullCanvasRoundedRect.test(source)) {
      failures.push(
        `${path.relative(repoRoot, file)}: old full-canvas rounded SVG background frame`
      );
    }
  }
}

async function collectSVGTextClutterFailures(failures) {
  const root = path.join(siteRoot, 'static', 'svg');
  if (!(await exists(root))) return;

  const files = (await listFiles(root)).filter((file) => file.endsWith('.svg'));
  const bannedPhrases = [
    'Everything hangs',
    'One signature',
    'Six package',
    'Provider choice',
    'RLM keeps',
    'Production feedback',
    'MCP servers become',
    'Context stays',
    'GEPA optimizes',
    'Agents scale',
    'shared semantics',
    'generated packages',
    'prompt rendering',
  ];
  const textNodePattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  const fontSizePattern = /\bfont-size\s*:\s*(\d+(?:\.\d+)?)px\b/gi;
  const inlineFontSizePattern = /\bfont-size=["'](\d+(?:\.\d+)?)["']/gi;

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const rel = path.relative(repoRoot, file);

    for (const pattern of [fontSizePattern, inlineFontSizePattern]) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const size = Number(match[1]);
        if (size > 22) {
          failures.push(`${rel}: visible SVG font size ${size}px is too large`);
        }
      }
    }

    textNodePattern.lastIndex = 0;
    for (const match of source.matchAll(textNodePattern)) {
      const attrs = match[1] ?? '';
      const text = stripTags(match[2] ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) continue;

      if (/\bclass=["'][^"']*\btitle\b/i.test(attrs)) {
        failures.push(`${rel}: visible SVG title text must be removed`);
      }
      if (text.length > 32) {
        failures.push(`${rel}: visible SVG text is too long: "${text}"`);
      }
      if (text.includes(',')) {
        failures.push(`${rel}: visible SVG text must not use comma-list copy`);
      }
      if (/[.!?]/.test(text)) {
        failures.push(
          `${rel}: visible SVG text must stay label-like: "${text}"`
        );
      }
      for (const phrase of bannedPhrases) {
        if (text.toLowerCase().includes(phrase.toLowerCase())) {
          failures.push(`${rel}: old SVG copy remains: "${phrase}"`);
        }
      }
    }
  }
}

function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, '');
}
