const mermaidModule = await import('/vendor/mermaid/mermaid.esm.min.mjs');
const mermaid = mermaidModule.default;

const isDark = () =>
  document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches);

function themeVariables() {
  if (isDark()) {
    return {
      background: '#11110f',
      primaryColor: '#1e6f65',
      primaryTextColor: '#f3f0e8',
      primaryBorderColor: '#5fc9b8',
      secondaryColor: '#244766',
      secondaryTextColor: '#f3f0e8',
      secondaryBorderColor: '#8bb7e8',
      tertiaryColor: '#4b3d16',
      tertiaryTextColor: '#f3f0e8',
      tertiaryBorderColor: '#e1b64b',
      lineColor: '#8bb7e8',
      textColor: '#f3f0e8',
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace',
      fontSize: '18px',
      mainBkg: '#191814',
      secondBkg: '#222019',
      clusterBkg: '#191814',
      clusterBorder: '#33312b',
      edgeLabelBackground: '#191814',
      noteBkgColor: '#281d1a',
      noteTextColor: '#f3f0e8',
      noteBorderColor: '#e68b78',
    };
  }

  return {
    background: '#fbfaf6',
    primaryColor: '#d9f4ee',
    primaryTextColor: '#151515',
    primaryBorderColor: '#006b5b',
    secondaryColor: '#dcecff',
    secondaryTextColor: '#151515',
    secondaryBorderColor: '#205ea8',
    tertiaryColor: '#fff0c4',
    tertiaryTextColor: '#151515',
    tertiaryBorderColor: '#b77b00',
    lineColor: '#205ea8',
    textColor: '#151515',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace',
    fontSize: '18px',
    mainBkg: '#ffffff',
    secondBkg: '#f0eee6',
    clusterBkg: '#ffffff',
    clusterBorder: '#d8d5cc',
    edgeLabelBackground: '#ffffff',
    noteBkgColor: '#fae2dc',
    noteTextColor: '#151515',
    noteBorderColor: '#a33d2d',
  };
}

for (const node of document.querySelectorAll('.mermaid')) {
  node.dataset.originalMermaid = node.textContent ?? '';
}

function resetMermaid() {
  for (const node of document.querySelectorAll('.mermaid[data-processed]')) {
    node.removeAttribute('data-processed');
    if (node.dataset.originalMermaid) {
      node.textContent = node.dataset.originalMermaid;
    }
  }
}

function renderMermaid() {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: themeVariables(),
    flowchart: {
      curve: 'basis',
      htmlLabels: true,
      nodeSpacing: 48,
      rankSpacing: 62,
    },
  });
  mermaid.run({ querySelector: '.mermaid' });
}

renderMermaid();

function rerenderMermaid() {
  resetMermaid();
  renderMermaid();
}

window
  .matchMedia?.('(prefers-color-scheme: dark)')
  .addEventListener('change', rerenderMermaid);
window.addEventListener('ax-md-theme-change', rerenderMermaid);

// Diagrams inside content appended by the docs infinite scroll (site.js):
// stash the new nodes' sources, then render — run() skips processed nodes.
window.axMermaidAppend = () => {
  for (const node of document.querySelectorAll('.mermaid')) {
    if (node.dataset.originalMermaid === undefined) {
      node.dataset.originalMermaid = node.textContent ?? '';
    }
  }
  renderMermaid();
};
