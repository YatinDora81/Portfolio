/**
 * THE command table for the About-section terminal.
 *
 * The portfolio drives its real behaviour from this list — `help`, `ls`,
 * Tab-completion and the focus decision all read it — and the admin renders it
 * as a reference page. That's deliberate: a docs page that merely *described*
 * the terminal would go stale the first time a command changed. Because
 * `keepsFocus` is what the Enter handler actually consults, the reference
 * cannot lie about it.
 */

export type CommandKind = "nav" | "info" | "action" | "egg";

export interface TerminalCommand {
  cmd: string;
  kind: CommandKind;
  /** One line, shown by `help` and in the admin table. */
  summary: string;
  /** What the visitor actually sees after Enter. */
  output: string;
  /**
   * Does the caret stay in the prompt?
   *
   * Only commands that MOVE you release it — otherwise you'd be typing at a
   * prompt scrolled off screen, with the mobile keyboard covering wherever you
   * just landed. Anything that answers inside the terminal keeps the caret.
   */
  keepsFocus: boolean;
  /** Listed by `help`/`ls` and offered by Tab. Easter eggs stay hidden. */
  discoverable: boolean;
  /** Extra spellings that run the same command. */
  aliases?: string[];
  /** nav only — the section this jumps to. */
  target?: string;
  label?: string;
}

export const TERMINAL_COMMANDS: TerminalCommand[] = [
  // ---- navigation: these move you, so they hand focus back ----
  {
    cmd: "skills", kind: "nav", target: "#skills", label: "Skills",
    summary: "jump to Skills",
    output: "prints “→ taking you to Skills…”, then smooth-scrolls to the section",
    keepsFocus: false, discoverable: true,
  },
  {
    cmd: "experience", kind: "nav", target: "#experience", label: "Experience",
    summary: "jump to Experience",
    output: "prints “→ taking you to Experience…”, then smooth-scrolls to the section",
    keepsFocus: false, discoverable: true,
  },
  {
    cmd: "projects", kind: "nav", target: "#projects", label: "Projects",
    summary: "jump to Projects",
    output: "prints “→ taking you to Projects…”, then smooth-scrolls to the section",
    keepsFocus: false, discoverable: true,
  },
  {
    cmd: "education", kind: "nav", target: "#education", label: "Education",
    summary: "jump to Education",
    output: "prints “→ taking you to Education…”, then smooth-scrolls to the section",
    keepsFocus: false, discoverable: true,
  },
  {
    cmd: "blogs", kind: "nav", target: "#blogs", label: "Blogs",
    summary: "jump to Blogs",
    output: "prints “→ taking you to Blogs…”, then smooth-scrolls to the section. Hidden entirely when the CMS has no published posts.",
    keepsFocus: false, discoverable: true,
  },
  {
    cmd: "contact", kind: "nav", target: "#contact", label: "Contact",
    summary: "jump to Contact",
    output: "prints “→ taking you to Contact…”, then smooth-scrolls to the section",
    keepsFocus: false, discoverable: true,
  },

  // ---- answers in place: caret stays ----
  {
    cmd: "whoami", kind: "info",
    summary: "who is this guy",
    output: "prints every About paragraph from the CMS, with company logos inlined on bolded names. Also the command that auto-types itself when the section scrolls into view.",
    keepsFocus: true, discoverable: true,
  },
  {
    cmd: "help", kind: "info",
    summary: "list every command",
    output: "prints this table — one line per command — plus a tip line about Tab, ↑ and Esc",
    keepsFocus: true, discoverable: true,
  },
  {
    cmd: "ls", kind: "info",
    summary: "list sections",
    output: "prints the section names on one line, space separated — only the sections actually present on the page",
    keepsFocus: true, discoverable: true,
  },
  {
    cmd: "clear", kind: "info",
    summary: "clean this mess",
    output: "empties the scrollback. History (↑) survives.",
    keepsFocus: true, discoverable: true,
  },

  // ---- leaves the page ----
  {
    cmd: "resume", kind: "action", aliases: ["cv"],
    summary: "open my resume",
    output: "prints “→ opening resume…” and opens the resume URL in a new tab",
    keepsFocus: false, discoverable: true,
  },

  // ---- undocumented on purpose: not in help, ls, or Tab ----
  {
    cmd: "sudo", kind: "egg",
    summary: "nice try",
    output: "“[sudo] password for yatin: ✗ — nice try 😉”",
    keepsFocus: true, discoverable: false,
  },
  {
    cmd: "cat", kind: "egg",
    summary: "points at the navbar cat",
    output: "“🐾 the cat is in the navbar, not in the terminal”",
    keepsFocus: true, discoverable: false,
  },
];

/** Resolves a typed word to its command, aliases included. */
export function findCommand(name: string): TerminalCommand | undefined {
  const n = name.trim().toLowerCase();
  return TERMINAL_COMMANDS.find(
    (c) => c.cmd === n || (c.aliases ?? []).includes(n)
  );
}

/** Nav entries in display order — the source for `ls` and section jumps. */
export const NAV_COMMANDS = TERMINAL_COMMANDS.filter(
  (c) => c.kind === "nav"
) as (TerminalCommand & { target: string; label: string })[];

/** What an unrecognised word produces. */
export const NOT_FOUND_OUTPUT = "zsh: command not found: <word>, then a hint pointing at `help`";
