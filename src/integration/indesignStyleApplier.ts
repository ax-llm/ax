import { analyzeTextStyles, applyStylesToText } from '../ai/google-gemini/api';
import { getStyleGuide } from '../styleguide';
import { loadBookDraft, saveBookDraft } from '../bookDraft';

/**
 * Applies styles from the styleguide to text in the book draft file using Google Gemini API.
 */
async function applyStylesFromStyleGuide() {
  const styleGuide = getStyleGuide();
  const bookDraft = loadBookDraft();

  for (const paragraph of bookDraft.paragraphs) {
    const analysisResults = await analyzeTextStyles(paragraph.text);
    const suggestedStyles = analysisResults.map(result => styleGuide.findStyle(result));

    applyStylesToText(paragraph, suggestedStyles);
  }

  saveBookDraft(bookDraft);
}

applyStylesFromStyleGuide();
