export interface TemplateVars {
  name: string;
  purpose: string;
}

export const TEMPLATE_TOKENS = ["{{name}}", "{{purpose}}"] as const;

// text only, never HTML; renderReplyEmail escapes later
export function applyVars(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{\s*(name|purpose)\s*\}\}/g, (_match, key: string) =>
    key === "name" ? vars.name : vars.purpose
  );
}

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
