export const TAB_KEYS = ["inbox", "starred", "replied", "archived", "spam"] as const;

export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_LABEL: Record<TabKey, string> = {
  inbox: "Inbox",
  starred: "Starred",
  replied: "Replied",
  archived: "Archived",
  spam: "Spam",
};

export function isTab(value: unknown): value is TabKey {
  return typeof value === "string" && (TAB_KEYS as readonly string[]).includes(value);
}

// Keyed by the codes `scoreSpam` writes.
const REASON_LABEL: Record<string, string> = {
  "honeypot-filled": "filled the hidden honeypot field",
  "turnstile-failed": "failed the Turnstile challenge",
  "timing-token-invalid": "the timing token was forged or expired",
  "timing-token-absent": "no timing token arrived",
  "turnstile-missing": "the challenge widget never returned a token",
  "defenses-unavailable": "neither the challenge nor the timing token reached us — often an ad blocker",
  "submitted-too-fast": "submitted faster than a person can type it",
  "too-many-urls": "carries more links than an enquiry needs",
  "burst-from-sender": "one of several submissions from this sender inside an hour",
  "disposable-email": "sent from a disposable-email domain",
  "all-caps-name": "the name is written in all capitals",
  "vowelless-name": "the name has no vowels",
  "body-too-short": "the message is too short to say anything",
};

export function spamReasonLabel(code: string): string {
  return REASON_LABEL[code] ?? code;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Stable hue per sender, computed rather than tokenised because `.mava` ships no background. */
export function avatarStyle(name: string): React.CSSProperties {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return { background: `hsl(${h} 64% 88%)`, color: `hsl(${h} 58% 27%)` };
}
