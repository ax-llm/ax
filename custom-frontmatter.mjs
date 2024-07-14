// @ts-check
import { MarkdownPageEvent } from 'typedoc-plugin-markdown';
 
/**
 * @param {import('typedoc-plugin-markdown').MarkdownApplication} app
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function load(app) {
  app.renderer.on(
    MarkdownPageEvent.BEGIN,
    (page) => {
      /**
       * Update page.frontmatter object using information from the page model
       *
       * Here if the page is a class, we set the title to the class name
       */
        page.frontmatter = {
            // e.g add a title
            title: page.model?.name,
            // spread the existing frontmatter
            ...page.frontmatter,
        };
    },
  );

  app.renderer.on(
    MarkdownPageEvent.END,
    (page) => {
        page.contents = replaceAndFormat(page.contents)
        console.log(page.contents)
    },
  );

}

const replaceAndFormat = (text) => {
    text = text.replace(/\/[A-Za-z]+\.md/g, (match) => match.toLowerCase().replace('.md', ''));
    text = text.replace('../', '/apidocs/');
    return text
  };