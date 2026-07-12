const themeStorageKey = 'ax-md-theme';
const themeModes = ['auto', 'light', 'dark'];
const themeLabels = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
};

function readTheme() {
  try {
    const mode = localStorage.getItem(themeStorageKey) || 'auto';
    return themeModes.includes(mode) ? mode : 'auto';
  } catch {
    return 'auto';
  }
}

function writeTheme(mode) {
  try {
    localStorage.setItem(themeStorageKey, mode);
  } catch {}
}

function applyTheme(mode) {
  const resolvedMode = themeModes.includes(mode) ? mode : 'auto';
  if (resolvedMode === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.dataset.theme = resolvedMode;
  }

  for (const control of document.querySelectorAll('[data-theme-switcher]')) {
    if (control instanceof HTMLSelectElement) {
      control.value = resolvedMode;
    }
    if (control.matches('[data-theme-toggle]')) {
      const nextMode = nextThemeMode(resolvedMode);
      control.dataset.themeMode = resolvedMode;
      control.setAttribute(
        'aria-label',
        `Theme: ${themeLabels[resolvedMode]}. Switch to ${themeLabels[nextMode]} theme`
      );
      control.setAttribute('title', `Theme: ${themeLabels[resolvedMode]}`);
    }
    for (const button of control.querySelectorAll('[data-theme-choice]')) {
      const active = button.dataset.themeChoice === resolvedMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
}

function nextThemeMode(mode) {
  const index = themeModes.indexOf(mode);
  return themeModes[(index + 1) % themeModes.length] || 'auto';
}

for (const select of document.querySelectorAll('[data-language-switcher]')) {
  select.addEventListener('change', () => {
    const href = select.value;
    if (href) window.location.href = href;
  });
}

for (const menu of document.querySelectorAll(
  '[data-language-menu], [data-site-menu]'
)) {
  for (const link of menu.querySelectorAll('a')) {
    link.addEventListener('click', () => {
      menu.open = false;
    });
  }
}

document.addEventListener('click', (event) => {
  for (const menu of document.querySelectorAll(
    '[data-language-menu], [data-site-menu]'
  )) {
    if (!menu.contains(event.target)) {
      menu.open = false;
    }
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  for (const menu of document.querySelectorAll(
    '[data-language-menu], [data-site-menu]'
  )) {
    menu.open = false;
  }
});

applyTheme(readTheme());

function setTheme(mode) {
  writeTheme(mode);
  applyTheme(mode);
  window.dispatchEvent(new CustomEvent('ax-md-theme-change'));
}

for (const control of document.querySelectorAll('[data-theme-switcher]')) {
  if (control instanceof HTMLSelectElement) {
    control.addEventListener('change', () => {
      setTheme(control.value || 'auto');
    });
    continue;
  }

  if (control.matches('[data-theme-toggle]')) {
    control.addEventListener('click', () => {
      setTheme(nextThemeMode(readTheme()));
    });
    continue;
  }

  for (const button of control.querySelectorAll('[data-theme-choice]')) {
    button.addEventListener('click', () => {
      setTheme(button.dataset.themeChoice || 'auto');
    });
  }
}

const mobileDocs = document.querySelector('[data-mobile-docs]');
for (const link of mobileDocs?.querySelectorAll('a') ?? []) {
  link.addEventListener('click', () => {
    mobileDocs.open = false;
  });
}

function writeClipboardSync(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}

async function writeClipboard(text) {
  if (writeClipboardSync(text)) return;

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  throw new Error('copy failed');
}

function selectCodeText(code) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(code);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

for (const button of document.querySelectorAll('[data-copy-code]')) {
  button.addEventListener('click', async () => {
    const block = button.closest('[data-code-block]');
    const code = block?.querySelector('pre code, pre');
    if (!code) return;

    const originalLabel = button.textContent || 'Copy';
    try {
      await writeClipboard(code.textContent || '');
      button.textContent = 'Copied';
      button.dataset.copied = 'true';
    } catch {
      selectCodeText(code);
      button.textContent = 'Selected';
      button.dataset.copied = 'selected';
    }

    window.setTimeout(() => {
      button.textContent = originalLabel;
      delete button.dataset.copied;
    }, 1600);
  });
}

const homeLanguageRoot = document.querySelector('[data-home-language-root]');
const homeLanguageButtons = [
  ...document.querySelectorAll('[data-home-language]'),
];
const homeLanguages = homeLanguageButtons
  .map((button) => button.dataset.homeLanguage)
  .filter(Boolean);
const HOME_LANGUAGE_FADE_OUT_MS = 260;
const HOME_LANGUAGE_FADE_IN_MS = 520;
const HOME_LANGUAGE_ROTATION_MS = 12000;
const HOME_LANGUAGE_STORAGE_KEY = 'ax-home-language';
const homeHeroExamples = [
  ...new Set(
    [...document.querySelectorAll('[data-home-example]')]
      .map((panel) => panel.dataset.homeExample)
      .filter(Boolean)
  ),
];
let homeLanguageTimer;
let homeLanguageTransitioning = false;
let homeLanguageQueued;
let homeActiveHeroExample = homeHeroExamples[0];

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function normalizeHomeHeroExample(example) {
  if (homeHeroExamples.length === 0) return undefined;
  return homeHeroExamples.includes(example) ? example : homeHeroExamples[0];
}

function pickNextHomeHeroExample() {
  if (homeHeroExamples.length < 2) return homeActiveHeroExample;

  let next =
    homeHeroExamples[Math.floor(Math.random() * homeHeroExamples.length)];
  if (next === homeActiveHeroExample) {
    const index = homeHeroExamples.indexOf(next);
    next = homeHeroExamples[(index + 1) % homeHeroExamples.length];
  }
  return next;
}

function isHomeLanguageTargetActive(language, heroExample) {
  return (
    language === homeLanguageRoot?.dataset.activeLanguage &&
    normalizeHomeHeroExample(heroExample) === homeActiveHeroExample
  );
}

function setHomeVariantActive(element, active) {
  element.dataset.homeActive = String(active);
  if (active) {
    element.removeAttribute('aria-hidden');
    element.removeAttribute('inert');
  } else {
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('inert', '');
  }

  for (const button of element.querySelectorAll('button, [tabindex]')) {
    if (active) {
      if (button.dataset.homePreviousTabindex) {
        button.setAttribute('tabindex', button.dataset.homePreviousTabindex);
        delete button.dataset.homePreviousTabindex;
      } else {
        button.removeAttribute('tabindex');
      }
      continue;
    }

    if (
      button.hasAttribute('tabindex') &&
      button.getAttribute('tabindex') !== '-1'
    ) {
      button.dataset.homePreviousTabindex = button.getAttribute('tabindex');
    }
    button.setAttribute('tabindex', '-1');
  }
}

function isHomeCodePanelTarget(panel, language, heroExample) {
  const panelExample = panel.dataset.homeExample;
  return (
    panel.dataset.homeLang === language &&
    (!panelExample || panelExample === heroExample)
  );
}

function applyHomeLanguage(language, heroExample = homeActiveHeroExample) {
  if (!homeLanguageRoot || !homeLanguages.includes(language)) return;

  const activeHeroExample = normalizeHomeHeroExample(heroExample);
  homeLanguageRoot.dataset.activeLanguage = language;
  if (activeHeroExample) {
    homeActiveHeroExample = activeHeroExample;
    homeLanguageRoot.dataset.activeHeroExample = activeHeroExample;
  }

  for (const panel of document.querySelectorAll('[data-home-code-panel]')) {
    setHomeVariantActive(
      panel,
      isHomeCodePanelTarget(panel, language, homeActiveHeroExample)
    );
  }

  for (const text of document.querySelectorAll('[data-home-lang-text]')) {
    setHomeVariantActive(text, text.dataset.homeLangText === language);
  }

  for (const output of document.querySelectorAll(
    '[data-home-output-variant]'
  )) {
    const outputExample = output.dataset.homeExample;
    setHomeVariantActive(
      output,
      output.dataset.homeOutputVariant === language &&
        (!outputExample || outputExample === homeActiveHeroExample)
    );
  }

  for (const button of homeLanguageButtons) {
    const active = button.dataset.homeLanguage === language;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }

  for (const tab of document.querySelectorAll('[data-home-example-tab]')) {
    const active = tab.dataset.homeExampleTab === homeActiveHeroExample;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }

  for (const link of document.querySelectorAll('[data-home-lang-href]')) {
    link.setAttribute('href', `/${language}/${link.dataset.homeLangHref}`);
  }

  reserveHomeHeroPanelHeight();
}

function homeLanguageTransitionTargets() {
  return [
    ...document.querySelectorAll(
      '.home-code-rotator, .home-output-panel, .home-install code'
    ),
  ];
}

const HOME_ACTIVE_VARIANT = '[data-home-active="true"]';

function freezeHomeLanguageLayout() {
  const targets = homeLanguageTransitionTargets();
  for (const target of targets) {
    if (target instanceof HTMLElement) {
      const height = target.offsetHeight;
      const active = target.querySelector(HOME_ACTIVE_VARIANT);
      // Everything around the swapped variant (panel title, padding). Kept so
      // the post-swap height can be computed exactly: scrollHeight can never
      // report smaller than the frozen height, so shrinking containers used
      // to hold their old size and snap on release instead of animating.
      target.dataset.homeChromeHeight = String(
        height - (active?.offsetHeight ?? height)
      );
      target.style.height = `${height}px`;
    }
  }
  return targets;
}

function animateHomeLanguageLayout(targets) {
  for (const target of targets) {
    if (target instanceof HTMLElement) {
      const active = target.querySelector(HOME_ACTIVE_VARIANT);
      const chrome = Number(target.dataset.homeChromeHeight);
      delete target.dataset.homeChromeHeight;
      target.style.height =
        active && Number.isFinite(chrome)
          ? `${chrome + active.offsetHeight}px`
          : `${target.scrollHeight}px`;
    }
  }
}

function releaseHomeLanguageLayout(targets = homeLanguageTransitionTargets()) {
  for (const target of targets) {
    if (target instanceof HTMLElement) {
      target.style.height = '';
    }
  }
}

const homeHeroPanel = document.querySelector('.home-hero-panel');
let homeHeroPanelChromeHeight;

function measureHomeHeroExampleTotals(language) {
  return homeHeroExamples.map((example) => {
    const code = homeHeroPanel.querySelector(
      `[data-home-code-panel][data-home-lang="${language}"][data-home-example="${example}"]`
    );
    const output = homeHeroPanel.querySelector(
      `[data-home-output-variant="${language}"][data-home-example="${example}"]`
    );
    if (!code || !output) return 0;
    return code.offsetHeight + output.offsetHeight;
  });
}

// Reserve the hero panel's height at the tallest example of the active
// language, so switching examples (tab click or auto-advance) never reflows
// the page below the hero.
function reserveHomeHeroPanelHeight(options = {}) {
  if (!homeHeroPanel || !homeLanguageRoot || homeHeroExamples.length < 2) {
    return;
  }
  const language = options.language || homeLanguageRoot.dataset.activeLanguage;
  if (!language) return;
  const totals = measureHomeHeroExampleTotals(language);
  if (totals.some((total) => total <= 0)) return;

  if (options.useSettledChrome) {
    // Mid-transition the containers hold frozen px heights, so the panel's
    // natural height is unreadable — reuse the chrome captured at settle.
    if (homeHeroPanelChromeHeight === undefined) return;
  } else {
    if (homeLanguageTransitioning) return;
    const activeIndex = Math.max(
      0,
      homeHeroExamples.indexOf(homeActiveHeroExample)
    );
    homeHeroPanel.style.minHeight = '';
    homeHeroPanelChromeHeight =
      homeHeroPanel.offsetHeight - totals[activeIndex];
  }

  homeHeroPanel.style.minHeight = `${Math.ceil(
    homeHeroPanelChromeHeight + Math.max(...totals)
  )}px`;
  if (!homeHeroPanel.dataset.homeReserved) {
    // Enable the min-height transition only after the first reservation so
    // the initial one applies without animating up from zero on page load.
    window.requestAnimationFrame(() => {
      homeHeroPanel.dataset.homeReserved = 'true';
    });
  }
}

function runHomeLanguageViewTransition(update) {
  if (typeof document.startViewTransition !== 'function') {
    update();
    return Promise.resolve();
  }

  const transition = document.startViewTransition(update);
  return (transition.updateCallbackDone || transition.ready).catch(() => {});
}

function finishHomeLanguageTransition(targets) {
  if (!homeLanguageRoot) return;
  delete homeLanguageRoot.dataset.homeLanguageTransition;
  releaseHomeLanguageLayout(targets);
  homeLanguageTransitioning = false;
  reserveHomeHeroPanelHeight();

  const queued = homeLanguageQueued;
  homeLanguageQueued = undefined;
  if (
    queued &&
    !isHomeLanguageTargetActive(queued.language, queued.heroExample)
  ) {
    setHomeLanguage(queued.language, { heroExample: queued.heroExample });
  }
}

function setHomeLanguage(language, options = {}) {
  if (!homeLanguageRoot || !homeLanguages.includes(language)) return;
  const heroExample = normalizeHomeHeroExample(
    options.heroExample || homeActiveHeroExample
  );
  if (isHomeLanguageTargetActive(language, heroExample)) return;

  const animate = options.animate !== false && !prefersReducedMotion();
  if (!animate) {
    applyHomeLanguage(language, heroExample);
    return;
  }

  if (homeLanguageTransitioning) {
    homeLanguageQueued = { language, heroExample };
    return;
  }

  homeLanguageTransitioning = true;
  const languageChanged = language !== homeLanguageRoot.dataset.activeLanguage;
  const targets = freezeHomeLanguageLayout();
  homeLanguageRoot.dataset.homeLanguageTransition = 'out';

  window.setTimeout(() => {
    const update = () => applyHomeLanguage(language, heroExample);
    // Example-only switches (typed call <-> agent, incl. the auto-advance)
    // keep the panel crossfade but skip the whole-page view transition: its
    // root snapshot freezes the page mid-scroll and reads as jank.
    let applied;
    if (languageChanged) {
      applied = runHomeLanguageViewTransition(update);
    } else {
      update();
      applied = Promise.resolve();
    }
    applied.then(() => {
      if (!homeLanguageRoot) return;
      window.requestAnimationFrame(() => {
        if (!homeLanguageRoot) return;
        homeLanguageRoot.dataset.homeLanguageTransition = 'in';
        reserveHomeHeroPanelHeight({ language, useSettledChrome: true });
        animateHomeLanguageLayout(targets);
        window.setTimeout(
          () => finishHomeLanguageTransition(targets),
          HOME_LANGUAGE_FADE_IN_MS
        );
      });
    });
  }, HOME_LANGUAGE_FADE_OUT_MS);
}

function stopHomeLanguageRotation() {
  window.clearTimeout(homeLanguageTimer);
  homeLanguageTimer = undefined;
  if (homeLanguageRoot) {
    homeLanguageRoot.dataset.homeRotation = 'paused';
  }
}

// The language never auto-rotates — users pick it (and the choice persists).
// Only the hero example (typed call <-> agent) advances on a timer, within the
// active language, until the first explicit interaction.
function startHomeExampleRotation() {
  if (!homeLanguageRoot || homeHeroExamples.length < 2) return;
  if (prefersReducedMotion()) {
    homeLanguageRoot.dataset.homeRotation = 'reduced-motion';
    return;
  }

  const rotate = () => {
    homeLanguageTimer = window.setTimeout(rotate, HOME_LANGUAGE_ROTATION_MS);
    // A transition started while the tab is hidden stalls at the fade-out
    // stage (rAF never fires) — skip ticks until the page is visible again.
    if (document.hidden) return;
    const current = homeLanguageRoot.dataset.activeLanguage || homeLanguages[0];
    setHomeLanguage(current, { heroExample: pickNextHomeHeroExample() });
  };

  homeLanguageRoot.dataset.homeRotation = 'auto';
  homeLanguageTimer = window.setTimeout(rotate, HOME_LANGUAGE_ROTATION_MS);
}

function readStoredHomeLanguage() {
  try {
    return localStorage.getItem(HOME_LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeHomeLanguage(language) {
  try {
    localStorage.setItem(HOME_LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Storage unavailable (private mode) — the choice just won't persist.
  }
}

if (homeLanguageRoot) {
  const savedLanguage = readStoredHomeLanguage();
  applyHomeLanguage(
    savedLanguage && homeLanguages.includes(savedLanguage)
      ? savedLanguage
      : homeLanguageRoot.dataset.activeLanguage || homeLanguages[0]
  );
  for (const button of homeLanguageButtons) {
    button.addEventListener('click', () => {
      stopHomeLanguageRotation();
      setHomeLanguage(button.dataset.homeLanguage);
      storeHomeLanguage(button.dataset.homeLanguage);
    });
  }
  for (const tab of document.querySelectorAll('[data-home-example-tab]')) {
    tab.addEventListener('click', () => {
      stopHomeLanguageRotation();
      const current =
        homeLanguageRoot.dataset.activeLanguage || homeLanguages[0];
      setHomeLanguage(current, { heroExample: tab.dataset.homeExampleTab });
    });
  }
  startHomeExampleRotation();

  if (homeHeroPanel) {
    let reserveResizeTimer;
    window.addEventListener('resize', () => {
      window.clearTimeout(reserveResizeTimer);
      reserveResizeTimer = window.setTimeout(
        () => reserveHomeHeroPanelHeight(),
        150
      );
    });
    // Web fonts change code metrics — re-measure once they are in.
    document.fonts?.ready?.then(() => reserveHomeHeroPanelHeight());
  }
}

const homeLanguageBar = document.querySelector('[data-home-language-bar]');
if (homeLanguageBar && 'IntersectionObserver' in window) {
  const sentinel = document.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  homeLanguageBar.before(sentinel);
  new IntersectionObserver(
    ([entry]) => {
      homeLanguageBar.classList.toggle('is-stuck', !entry.isIntersecting);
    },
    { rootMargin: '-68px 0px 0px 0px' }
  ).observe(sentinel);
}

const searchRoot = document.querySelector('[data-site-search]');
const searchInput = searchRoot?.querySelector('[data-search-input]');
const searchResults = searchRoot?.querySelector('[data-search-results]');
const searchScopeToggle = searchRoot?.querySelector(
  '[data-search-scope-toggle]'
);
const searchScopeLabel = searchRoot?.querySelector('[data-search-scope-label]');
const currentSearchLanguage =
  searchRoot?.dataset.searchLanguage || 'typescript';
const currentSearchLanguageLabel =
  searchRoot?.dataset.searchLanguageLabel || 'TypeScript';
const languageLabels = {
  cpp: 'C++',
  go: 'Go',
  java: 'Java',
  python: 'Python',
  rust: 'Rust',
  typescript: 'TypeScript',
};
const sectionLabels = {
  api: 'API Docs',
  concepts: 'Concepts',
  examples: 'Examples',
  home: 'Home',
  skills: 'Skills',
  subsystems: 'Subsystems',
  'quick-start': 'Quick Start',
};
const kindLabels = {
  api: 'API',
  class: 'Class',
  concepts: 'Concept',
  enum: 'Enum',
  example: 'Example',
  examples: 'Example',
  function: 'Function',
  interface: 'Interface',
  skill: 'Skill',
  skills: 'Skill',
  type: 'Type',
  variable: 'Variable',
};
const SEARCH_VARIANT_LIMIT = 6;
const SEARCH_RESULT_POOL_LIMIT = 18;
const SEARCH_RESULT_DISPLAY_LIMIT = 9;
const SEARCH_ANCHOR_DISPLAY_LIMIT = 3;
let pagefindModule;
let searchTimer;
let searchScope = 'language';
let searchRequestID = 0;
let activeSearchIndex = -1;
let activeSearchItems = [];
let searchView;

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizePagefindHTML(value) {
  const template = document.createElement('template');
  template.innerHTML = String(value ?? '');
  for (const element of template.content.querySelectorAll('*')) {
    if (element.localName === 'mark') {
      for (const attr of [...element.attributes]) {
        element.removeAttribute(attr.name);
      }
      continue;
    }
    element.replaceWith(document.createTextNode(element.textContent || ''));
  }
  return template.innerHTML;
}

function stripHTML(value) {
  return String(value ?? '').replaceAll(/<[^>]*>/g, ' ');
}

function normalizeSearchText(value) {
  return stripHTML(value)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replaceAll(/[^a-z0-9@/_+.#-]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function compactSearchText(value) {
  return normalizeSearchText(value).replaceAll(/[^a-z0-9]+/g, '');
}

function queryFragments(query) {
  return splitCamelCase(query)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
}

function queryTerms(query) {
  const terms = new Set(
    normalizeSearchText(query)
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 1)
  );
  for (const term of queryFragments(query)) {
    terms.add(term);
  }
  return [...terms];
}

function splitCamelCase(value) {
  return String(value ?? '')
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll(/([A-Z])([A-Z][a-z])/g, '$1 $2');
}

function searchVariants(query) {
  const raw = query.trim();
  const variants = new Set([raw]);
  const noParens = raw
    .replaceAll(/\(\s*(?:\.\.\.)?\s*\)/g, '')
    .replaceAll(/[()]/g, '')
    .trim();
  const spaced = splitCamelCase(noParens)
    .replaceAll(/[@/._-]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  const compact = noParens.replaceAll(/[@/._\s-]+/g, '').trim();
  const packageish = noParens
    .replace(/^@/, '')
    .replaceAll(/[/.]+/g, ' ')
    .trim();
  const hyphenated = splitCamelCase(noParens)
    .replaceAll(/[@/._\s]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .trim();
  const dotted = splitCamelCase(noParens)
    .replaceAll(/[@/_\s-]+/g, '.')
    .replaceAll(/\.+/g, '.')
    .replaceAll(/^\.|\.$/g, '')
    .trim();

  for (const candidate of [
    noParens,
    spaced,
    compact,
    packageish,
    hyphenated,
    dotted,
  ]) {
    if (candidate && candidate.toLowerCase() !== raw.toLowerCase()) {
      variants.add(candidate);
    }
  }

  return [...variants].slice(0, SEARCH_VARIANT_LIMIT);
}

function queryLanguageIntent(query) {
  const raw = stripHTML(query).toLowerCase();
  const fragments = queryFragments(query);

  if (raw.includes('c++') || fragments.includes('cpp')) return 'cpp';
  if (raw.includes('@ax-llm/ax')) return 'typescript';
  if (raw.includes('github.com/ax-llm/ax')) return 'go';
  if (raw.includes('com.axllm')) return 'java';
  if (fragments.includes('typescript')) return 'typescript';
  if (fragments.includes('python')) return 'python';
  if (fragments.includes('java')) return 'java';
  if (fragments.includes('rust')) return 'rust';
  if (fragments.includes('golang')) return 'go';
  if (fragments[0] === 'go') return 'go';

  return '';
}

function searchContext(query) {
  const intentLanguage = queryLanguageIntent(query);
  const filterLanguage =
    searchScope === 'language' ? intentLanguage || currentSearchLanguage : '';
  const options = filterLanguage
    ? {
        filters: {
          language: filterLanguage,
        },
      }
    : {};
  const scopeLabel =
    searchScope === 'all'
      ? 'all docs'
      : `${formatLanguage(filterLanguage || currentSearchLanguage)} docs`;

  return {
    filterLanguage,
    intentLanguage,
    options,
    scopeLabel,
  };
}

function setSearchExpanded(expanded) {
  if (!searchInput || !searchResults) return;
  searchInput.setAttribute('aria-expanded', String(expanded));
  if (!expanded) {
    searchInput.removeAttribute('aria-activedescendant');
  }
}

function hideSearchResults() {
  if (!searchResults) return;
  searchResults.hidden = true;
  activeSearchIndex = -1;
  activeSearchItems = [];
  searchView = undefined;
  setSearchExpanded(false);
}

function setSearchStatus(text) {
  if (!searchResults) return;
  searchResults.hidden = false;
  searchResults.innerHTML = `<div class="search-status" role="status">${escapeHTML(text)}</div>`;
  setSearchExpanded(true);
}

async function loadPagefind() {
  if (pagefindModule) return pagefindModule;
  pagefindModule = await import('/pagefind/pagefind.js');
  await pagefindModule.options?.({
    excerptLength: 34,
    highlightParam: 'highlight',
    ranking: {
      pageLength: 0.55,
      termFrequency: 0.72,
      termSimilarity: 1,
      termSaturation: 1,
      metaWeights: {
        title: 8,
        symbol: 8,
        slug: 6,
        source: 5,
        kind: 3,
        description: 2,
        section: 2,
      },
    },
  });
  return pagefindModule;
}

let searchWarm;
function warmSearch() {
  searchWarm ??= loadPagefind()
    .then((pagefind) => pagefind.init?.())
    .catch(() => {
      searchWarm = undefined;
    });
}
searchRoot?.addEventListener('pointerenter', warmSearch);
searchInput?.addEventListener('keydown', warmSearch);

function cleanResultURL(url, { keepHash = true } = {}) {
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.delete('highlight');
    if (!keepHash) parsed.hash = '';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return String(url ?? '').split('?highlight=')[0];
  }
}

function pageKey(url) {
  return cleanResultURL(url, { keepHash: false });
}

function formatSection(section) {
  return sectionLabels[section] || titleCase(section || 'Docs');
}

function formatLanguage(language) {
  return languageLabels[language] || titleCase(language || 'Docs');
}

function formatKind(kind) {
  return kindLabels[kind] || titleCase(kind || '');
}

function titleCase(value) {
  return String(value ?? '')
    .replaceAll(/[-_]+/g, ' ')
    .replaceAll(/\b\w/g, (match) => match.toUpperCase());
}

function compactSource(source) {
  const text = String(source ?? '').trim();
  if (!text) return '';
  const parts = text.split('/');
  if (parts.length <= 2) return text;
  return parts.slice(-2).join('/');
}

function sourceSymbol(source) {
  const filename =
    String(source ?? '')
      .split('/')
      .pop() || '';
  return filename
    .replaceAll(/\.md$/g, '')
    .replaceAll(
      /^(Class|Interface|Function|TypeAlias|Variable|Enumeration|Enum)\./g,
      ''
    );
}

function candidateText(candidate) {
  return [
    candidate.title,
    candidate.pageTitle,
    candidate.plainExcerpt,
    candidate.meta?.description,
    candidate.meta?.kind,
    candidate.meta?.slug,
    candidate.meta?.source,
    candidate.meta?.section,
    candidate.meta?.symbol,
  ].join(' ');
}

function scoreCandidate(candidate, query, resultMeta, context) {
  const normalizedQuery = normalizeSearchText(query);
  const compactQuery = compactSearchText(query);
  const title = normalizeSearchText(candidate.title);
  const pageTitle = normalizeSearchText(candidate.pageTitle);
  const kind = normalizeSearchText(candidate.meta?.kind);
  const slug = normalizeSearchText(candidate.meta?.slug);
  const source = normalizeSearchText(candidate.meta?.source);
  const symbol = normalizeSearchText(
    candidate.meta?.symbol || sourceSymbol(candidate.meta?.source)
  );
  const text = normalizeSearchText(candidateText(candidate));
  const compactTitle = compactSearchText(candidate.title);
  const compactPageTitle = compactSearchText(candidate.pageTitle);
  const compactSymbol = compactSearchText(
    candidate.meta?.symbol || sourceSymbol(candidate.meta?.source)
  );
  const compactSlug = compactSearchText(candidate.meta?.slug);
  const compactSourceText = compactSearchText(candidate.meta?.source);
  const terms = queryTerms(query);
  const fragments = queryFragments(query);
  const matchedMetaFields = resultMeta.matchedMetaFields ?? [];
  const candidateLanguage = candidate.meta?.language;

  let score = Math.log1p(resultMeta.score || 0) * 16;
  score -= resultMeta.variantIndex * 5;
  score -= resultMeta.resultIndex * 0.35;

  if (title === normalizedQuery) score += 92;
  else if (title.includes(normalizedQuery)) score += 58;
  if (pageTitle === normalizedQuery) score += 60;
  else if (pageTitle.includes(normalizedQuery)) score += 34;
  if (symbol === normalizedQuery) score += 88;
  else if (symbol.includes(normalizedQuery)) score += 48;

  if (compactQuery) {
    if (compactTitle === compactQuery) score += 86;
    else if (compactTitle.includes(compactQuery)) score += 46;
    if (compactPageTitle === compactQuery) score += 46;
    else if (compactPageTitle.includes(compactQuery)) score += 24;
    if (compactSymbol === compactQuery) score += 88;
    else if (compactSymbol.includes(compactQuery)) score += 42;
    if (compactSlug.includes(compactQuery)) score += 38;
    if (compactSourceText.includes(compactQuery)) score += 34;
  }

  if (slug.includes(normalizedQuery)) score += 24;
  if (source.includes(normalizedQuery)) score += 22;
  if (candidate.isSubResult) score += 10;
  if (context?.intentLanguage) {
    score += candidateLanguage === context.intentLanguage ? 38 : -24;
  } else if (searchScope === 'all') {
    score += candidateLanguage === currentSearchLanguage ? 24 : 0;
  } else if (candidateLanguage === currentSearchLanguage) {
    score += 8;
  }
  if (matchedMetaFields.includes('title')) score += 18;
  if (matchedMetaFields.includes('symbol')) score += 18;
  if (matchedMetaFields.includes('slug')) score += 14;
  if (matchedMetaFields.includes('source')) score += 12;
  if (matchedMetaFields.includes('kind')) score += 8;

  if (terms.length) {
    const titleHits = terms.filter((term) => title.includes(term)).length;
    const symbolHits = terms.filter((term) => symbol.includes(term)).length;
    const sourceHits = terms.filter((term) => source.includes(term)).length;
    const slugHits = terms.filter((term) => slug.includes(term)).length;
    const textHits = terms.filter((term) => text.includes(term)).length;
    score +=
      titleHits * 9 +
      symbolHits * 9 +
      sourceHits * 4 +
      slugHits * 4 +
      textHits * 2;
    if (titleHits === terms.length) score += 18;
    if (symbolHits === terms.length) score += 20;
    if (sourceHits === terms.length) score += 10;
    if (slugHits === terms.length) score += 10;
    if (kind && terms.includes(kind)) score += 8;
  }

  if (fragments.length > 1) {
    const compactFragments = fragments.join('');
    if (compactTitle.includes(compactFragments)) score += 24;
    if (compactSymbol.includes(compactFragments)) score += 28;
    if (compactSourceText.includes(compactFragments)) score += 18;
    if (compactSlug.includes(compactFragments)) score += 18;
  }

  return score;
}

function buildCandidates(data) {
  const meta = data.meta ?? {};
  const pageTitle = meta.title || data.title || data.url;
  const baseCandidate = {
    title: pageTitle,
    pageTitle,
    url: data.url,
    excerpt: data.excerpt,
    plainExcerpt: data.plain_excerpt,
    meta,
    isSubResult: false,
  };
  const subCandidates = (data.sub_results ?? [])
    .slice(0, 6)
    .map((subResult) => ({
      title: subResult.title || pageTitle,
      pageTitle,
      url: subResult.url || data.url,
      excerpt: subResult.excerpt || data.excerpt,
      plainExcerpt: subResult.plain_excerpt || data.plain_excerpt,
      meta,
      isSubResult: Boolean(subResult.url && subResult.url !== data.url),
    }));

  return [baseCandidate, ...subCandidates];
}

async function searchPagefind(pagefind, query, requestID, context) {
  const variants = searchVariants(query);
  const { options } = context;
  await Promise.allSettled(
    variants.map((variant) => pagefind.preload?.(variant, options))
  );

  const primarySearch = pagefind.debouncedSearch
    ? await pagefind.debouncedSearch(variants[0], options, 90)
    : await pagefind.search(variants[0], options);
  if (requestID !== searchRequestID || primarySearch === null) return null;

  const extraSearches = await Promise.all(
    variants.slice(1).map((variant) => pagefind.search(variant, options))
  );
  if (requestID !== searchRequestID) return null;

  return [primarySearch, ...extraSearches].flatMap((search, variantIndex) =>
    (search?.results ?? [])
      .slice(0, SEARCH_RESULT_POOL_LIMIT)
      .map((result, resultIndex) => ({
        result,
        resultIndex,
        variantIndex,
      }))
  );
}

async function loadSearchItems(rawResults, query, requestID, context) {
  const loaded = await Promise.allSettled(
    rawResults.map(async (item) => ({
      item,
      data: await item.result.data(),
    }))
  );
  if (requestID !== searchRequestID) return [];

  const groupsByPage = new Map();
  for (const loadedResult of loaded) {
    if (loadedResult.status !== 'fulfilled') continue;
    const { item, data } = loadedResult.value;
    for (const candidate of buildCandidates(data)) {
      const score = scoreCandidate(
        candidate,
        query,
        {
          matchedMetaFields: item.result.matchedMetaFields,
          resultIndex: item.resultIndex,
          score: item.result.score,
          variantIndex: item.variantIndex,
        },
        context
      );
      const key = pageKey(candidate.url);
      let group = groupsByPage.get(key);
      if (!group) {
        group = {
          score: Number.NEGATIVE_INFINITY,
          page: undefined,
          anchors: new Map(),
        };
        groupsByPage.set(key, group);
      }
      group.score = Math.max(group.score, score);
      if (candidate.isSubResult) {
        const anchorKey = cleanResultURL(candidate.url);
        const previous = group.anchors.get(anchorKey);
        if (!previous || score > previous.score) {
          group.anchors.set(anchorKey, { ...candidate, score });
        }
      } else if (!group.page || score > group.page.score) {
        group.page = { ...candidate, score };
      }
    }
  }

  return [...groupsByPage.values()]
    .map((group) => {
      const anchors = [...group.anchors.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, SEARCH_ANCHOR_DISPLAY_LIMIT);
      const page = group.page ?? {
        ...anchors[0],
        url: pageKey(anchors[0].url),
        title: anchors[0].pageTitle,
      };
      const best = [page, ...anchors].reduce((a, b) =>
        b.score > a.score ? b : a
      );
      return {
        page,
        anchors,
        score: group.score,
        excerpt: best.excerpt,
        plainExcerpt: best.plainExcerpt,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH_RESULT_POOL_LIMIT);
}

function resultPath(item) {
  const parts = [
    formatSection(item.meta?.section),
    item.pageTitle && item.pageTitle !== item.title ? item.pageTitle : '',
  ].filter(Boolean);
  return parts.join(' / ');
}

function renderResultItem(item, index) {
  const title = escapeHTML(item.title || item.url);
  const url = escapeHTML(item.url);
  const language = escapeHTML(formatLanguage(item.meta?.language));
  const section = escapeHTML(formatSection(item.meta?.section));
  const kind = escapeHTML(formatKind(item.meta?.kind));
  const showKind = item.meta?.kind && item.meta.kind !== item.meta?.section;
  const source = escapeHTML(compactSource(item.meta?.source));
  const path = escapeHTML(resultPath(item));
  const excerpt = item.excerpt
    ? sanitizePagefindHTML(item.excerpt)
    : escapeHTML(item.plainExcerpt || item.meta?.description || '');

  return `
    <a id="site-search-result-${index}" class="search-result" role="option" aria-selected="false" href="${url}" data-search-result-index="${index}">
      <span class="search-result-main">
        <span class="search-result-title">${title}</span>
        <span class="search-result-badges">
          <span class="search-result-badge">${language}</span>
          <span class="search-result-badge">${section}</span>
          ${showKind ? `<span class="search-result-badge search-result-kind">${kind}</span>` : ''}
          ${source ? `<span class="search-result-source" title="${escapeHTML(item.meta?.source)}">${source}</span>` : ''}
        </span>
      </span>
      ${path ? `<span class="search-result-path">${path}</span>` : ''}
      ${excerpt ? `<span class="search-result-excerpt">${excerpt}</span>` : ''}
    </a>
  `;
}

function updateActiveSearchItem(nextIndex) {
  if (!searchInput || !searchResults || activeSearchItems.length === 0) return;
  activeSearchIndex = Math.max(
    0,
    Math.min(nextIndex, activeSearchItems.length - 1)
  );
  for (const result of searchResults.querySelectorAll(
    '[data-search-result-index]'
  )) {
    const active =
      Number(result.dataset.searchResultIndex) === activeSearchIndex;
    result.classList.toggle('active', active);
    result.setAttribute('aria-selected', String(active));
  }
  const activeID = `site-search-result-${activeSearchIndex}`;
  searchInput.setAttribute('aria-activedescendant', activeID);
  document.getElementById(activeID)?.scrollIntoView({ block: 'nearest' });
}

function renderAnchorItem(anchor, index) {
  return `
    <a id="site-search-result-${index}" class="search-result-anchor" role="option" aria-selected="false" href="${escapeHTML(anchor.url)}" data-search-result-index="${index}">
      <span class="search-result-anchor-hash" aria-hidden="true">#</span>
      <span class="search-result-anchor-title">${escapeHTML(anchor.title)}</span>
    </a>
  `;
}

function renderSearchResults(view, { restoreIndex = 0 } = {}) {
  if (!searchResults) return;
  const { groups, query, context, expanded } = view;
  const visible = expanded
    ? groups
    : groups.slice(0, SEARCH_RESULT_DISPLAY_LIMIT);
  const hiddenCount = groups.length - visible.length;

  const entries = [];
  const chunks = [];
  for (const group of visible) {
    const pageIndex = entries.length;
    entries.push({ type: 'page', url: group.page.url });
    const anchorHTML = group.anchors
      .map((anchor) => {
        const index = entries.length;
        entries.push({ type: 'anchor', url: anchor.url });
        return renderAnchorItem(anchor, index);
      })
      .join('');
    chunks.push(`
      <div class="search-result-group" role="group" aria-label="${escapeHTML(group.page.title)}">
        ${renderResultItem(
          {
            ...group.page,
            excerpt: group.excerpt,
            plainExcerpt: group.plainExcerpt,
          },
          pageIndex
        )}
        ${anchorHTML}
      </div>
    `);
  }
  if (hiddenCount > 0) {
    const index = entries.length;
    entries.push({ type: 'more' });
    chunks.push(
      `<button type="button" id="site-search-result-${index}" class="search-more" role="option" aria-selected="false" data-search-more data-search-result-index="${index}">Show ${hiddenCount} more result${hiddenCount === 1 ? '' : 's'}</button>`
    );
  }

  activeSearchItems = entries;
  searchResults.hidden = false;
  searchResults.innerHTML = `
    <div class="search-results-summary" role="presentation">
      <span>${groups.length} page${groups.length === 1 ? '' : 's'} for <strong>${escapeHTML(query)}</strong></span>
      <span>${escapeHTML(context.scopeLabel)}</span>
    </div>
    ${chunks.join('')}
  `;
  setSearchExpanded(true);
  if (entries.length) {
    updateActiveSearchItem(Math.min(restoreIndex, entries.length - 1));
  } else {
    activeSearchIndex = -1;
  }

  for (const result of searchResults.querySelectorAll(
    '[data-search-result-index]'
  )) {
    result.addEventListener('mousemove', () => {
      updateActiveSearchItem(Number(result.dataset.searchResultIndex));
    });
  }
  searchResults
    .querySelector('[data-search-more]')
    ?.addEventListener('click', expandSearchResults);
}

function expandSearchResults() {
  if (!searchView || searchView.expanded) return;
  const restoreIndex = activeSearchIndex;
  searchView.expanded = true;
  renderSearchResults(searchView, { restoreIndex });
  searchInput?.focus();
}

async function renderSearch(query) {
  const trimmed = query.trim();
  if (!searchResults) return;
  if (!trimmed) {
    hideSearchResults();
    searchResults.innerHTML = '';
    return;
  }

  const requestID = ++searchRequestID;
  const context = searchContext(trimmed);
  setSearchStatus(`Searching ${context.scopeLabel}...`);
  try {
    const pagefind = await loadPagefind();
    const rawResults = await searchPagefind(
      pagefind,
      trimmed,
      requestID,
      context
    );
    if (requestID !== searchRequestID || rawResults === null) return;
    const results = await loadSearchItems(
      rawResults,
      trimmed,
      requestID,
      context
    );
    if (requestID !== searchRequestID) return;

    if (results.length === 0) {
      setSearchStatus(
        searchScope === 'all'
          ? 'No results.'
          : `No results in ${formatLanguage(context.filterLanguage)} docs. Toggle All docs to widen the search.`
      );
      return;
    }

    searchView = {
      groups: results,
      query: trimmed,
      context,
      expanded: false,
    };
    renderSearchResults(searchView);
  } catch (error) {
    console.error('website search failed', error);
    setSearchStatus('Search index is generated by website:build.');
  }
}

function queueSearch(query, { immediate = false } = {}) {
  window.clearTimeout(searchTimer);
  const trimmed = query.trim();
  searchRequestID += 1;
  if (!trimmed) {
    hideSearchResults();
    if (searchResults) searchResults.innerHTML = '';
    return;
  }
  const context = searchContext(trimmed);
  setSearchStatus(`Searching ${context.scopeLabel}...`);
  searchTimer = window.setTimeout(
    () => {
      renderSearch(query);
    },
    immediate ? 0 : 140
  );
}

function updateSearchScopeUI() {
  if (!searchScopeToggle || !searchScopeLabel) return;
  const allDocs = searchScope === 'all';
  searchScopeLabel.textContent = allDocs
    ? 'All docs'
    : currentSearchLanguageLabel;
  searchScopeToggle.setAttribute('aria-pressed', String(allDocs));
  searchScopeToggle.setAttribute(
    'aria-label',
    allDocs
      ? `Search ${currentSearchLanguageLabel} documentation`
      : 'Search all documentation'
  );
  searchScopeToggle.setAttribute(
    'title',
    allDocs
      ? `Search ${currentSearchLanguageLabel} documentation`
      : 'Search all documentation'
  );
}

searchInput?.addEventListener('input', () => {
  queueSearch(searchInput.value);
});

searchInput?.addEventListener('focus', () => {
  warmSearch();
  if (searchInput.value.trim()) {
    queueSearch(searchInput.value, { immediate: true });
  }
});

searchScopeToggle?.addEventListener('click', () => {
  searchScope = searchScope === 'all' ? 'language' : 'all';
  updateSearchScopeUI();
  if (searchInput?.value.trim()) {
    queueSearch(searchInput.value, { immediate: true });
  }
});

document.addEventListener('click', (event) => {
  if (!searchRoot || searchRoot.contains(event.target)) return;
  hideSearchResults();
});

searchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && searchResults) {
    hideSearchResults();
    searchInput.blur();
    return;
  }
  if (event.key === 'ArrowDown' && activeSearchItems.length) {
    event.preventDefault();
    updateActiveSearchItem(activeSearchIndex + 1);
    return;
  }
  if (event.key === 'ArrowUp' && activeSearchItems.length) {
    event.preventDefault();
    updateActiveSearchItem(activeSearchIndex - 1);
    return;
  }
  if (event.key === 'Enter' && activeSearchItems[activeSearchIndex]) {
    event.preventDefault();
    const item = activeSearchItems[activeSearchIndex];
    if (item.type === 'more') {
      expandSearchResults();
      return;
    }
    window.location.href = item.url;
  }
});

updateSearchScopeUI();

document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  const target = event.target;
  const isTyping =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable;

  if (isTyping || !searchInput) return;
  event.preventDefault();
  searchInput.focus();
});

const searchShortcutHint = searchRoot?.querySelector('.search-shortcut');
const isApplePlatform = /Mac|iPhone|iPad|iPod/i.test(
  navigator.userAgentData?.platform || navigator.platform || ''
);
if (searchShortcutHint) {
  searchShortcutHint.textContent = isApplePlatform ? '⌘K' : 'Ctrl K';
}

document.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'k' || event.altKey || event.shiftKey) {
    return;
  }
  if (!(event.metaKey || event.ctrlKey) || !searchInput) return;
  event.preventDefault();
  warmSearch();
  searchInput.focus();
  searchInput.select();
});

const sectionNav = document.querySelector('.section-nav');

function updateSectionNavFades() {
  if (!sectionNav) return;
  const maxScroll = sectionNav.scrollWidth - sectionNav.clientWidth;
  sectionNav.classList.toggle('nav-fade-left', sectionNav.scrollLeft > 6);
  sectionNav.classList.toggle(
    'nav-fade-right',
    maxScroll - sectionNav.scrollLeft > 6
  );
}

sectionNav?.addEventListener('scroll', updateSectionNavFades, {
  passive: true,
});
window.addEventListener('resize', updateSectionNavFades);
updateSectionNavFades();

const homeStatsRoot = document.querySelector('[data-home-stats]');

async function fetchHomeStat(url, pick) {
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) {
    throw new Error(`stat request failed: ${response.status}`);
  }
  return pick(await response.json());
}

function applyHomeStats(root, stats) {
  const formatter = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  for (const [name, value] of Object.entries(stats)) {
    const target = root.querySelector(`[data-stat="${name}"]`);
    if (!target || !Number.isFinite(value)) continue;
    target.textContent = formatter.format(value);
    target.hidden = false;
    const link = target.closest('a');
    if (link) link.hidden = false;
  }
}

async function hydrateHomeStats(root) {
  const cacheKey = 'ax-home-stats-v1';
  const cacheTTL = 60 * 60 * 1000;

  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (cached && Date.now() - cached.time < cacheTTL) {
      applyHomeStats(root, cached.stats);
      return;
    }
  } catch {
    // Unreadable cache falls through to a live fetch.
  }

  const [stars, downloads] = await Promise.allSettled([
    fetchHomeStat(
      `https://api.github.com/repos/${root.dataset.repo}`,
      (data) => data.stargazers_count
    ),
    fetchHomeStat(
      `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(root.dataset.npmPackage)}`,
      (data) => data.downloads
    ),
  ]);

  const stats = {};
  if (stars.status === 'fulfilled') stats.stars = stars.value;
  if (downloads.status === 'fulfilled') stats.downloads = downloads.value;
  if (Object.keys(stats).length === 0) return;

  applyHomeStats(root, stats);
  try {
    sessionStorage.setItem(
      cacheKey,
      JSON.stringify({ time: Date.now(), stats })
    );
  } catch {
    // Private mode or full storage — live values are already applied.
  }
}

if (homeStatsRoot) {
  hydrateHomeStats(homeStatsRoot).catch(() => {});
}
