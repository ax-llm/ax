// @ts-check
import { MarkdownPageEvent } from 'typedoc-plugin-markdown';

/**
 * @param {import('typedoc-plugin-markdown').MarkdownApplication} app
 */
export function load(app) {
  app.renderer.on(MarkdownPageEvent.BEGIN, (page) => {
    // Update frontmatter with the page title
    page.frontmatter = {
      title: page.model?.name,
      ...page.frontmatter,
    };
  });

  app.renderer.on(MarkdownPageEvent.END, (page) => {
    // Transform specific link patterns in the page content
    page.contents = replaceAndFormat(page.contents);
  });
}

/**
 * Transforms markdown link paths to a specific format.
 * Examples:
 * [`AxChatResponse`](TypeAlias.AxChatResponse.md) -> [`AxChatResponse`](#typealiasaxchatresponse)
 *
 * @param {string | undefined} input - The input markdown content
 * @returns {string | undefined} Transformed markdown content
 */
function replaceAndFormat(input) {
  if (!input) return input;

  return input.replace(
    /(\[`?[^`\]]+`?\]\()([^)]+)(\))/g,
    (_match, linkText, path, closing) => {
      if (path.startsWith('https://')) {
        return path;
      }

      // Remove file extension
      let transformedPath = path.replace(/\.md$/, '');

      // Remove special characters like dots and convert to lowercase
      transformedPath = transformedPath
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '');

      transformedPath = `/apidocs/${transformedPath}`;

      console.log(transformedPath);

      return `${linkText}${transformedPath}${closing}`;
    }
  );
}
