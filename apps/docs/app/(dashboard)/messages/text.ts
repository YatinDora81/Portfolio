export interface TemplateVars {
  name: string;
  purpose: string;
}

export const TEMPLATE_TOKENS = ["{{name}}", "{{purpose}}"] as const;

/**
 * Substitutes into *text*, never into HTML. The outgoing body is escaped later,
 * by `renderReplyEmail`, and that ordering is what makes a sender-supplied name
 * safe — substituting into rendered HTML would put it past the escape.
 */
export function applyVars(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{\s*(name|purpose)\s*\}\}/g, (_match, key: string) =>
    key === "name" ? vars.name : vars.purpose
  );
}

/** Inverts `escapeHtmlLines`, so a stored template is editable as text in the composer. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
