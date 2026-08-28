export type CommandKind = "nav" | "info" | "action" | "egg";

export interface TerminalCommand {
  cmd: string;
  kind: CommandKind;
  summary: string;
  output: string;
  keepsFocus: boolean;
  discoverable: boolean;
  aliases?: string[];
  target?: string;
  label?: string;
}

export const TERMINAL_COMMANDS: TerminalCommand[] = [
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

  {
    cmd: "resume", kind: "action", aliases: ["cv"],
    summary: "open my resume",
    output: "prints “→ opening resume…” and opens the resume URL in a new tab",
    keepsFocus: false, discoverable: true,
  },

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

export function findCommand(name: string): TerminalCommand | undefined {
  const n = name.trim().toLowerCase();
  return TERMINAL_COMMANDS.find(
    (c) => c.cmd === n || (c.aliases ?? []).includes(n)
  );
}

export const NAV_COMMANDS = TERMINAL_COMMANDS.filter(
  (c) => c.kind === "nav"
) as (TerminalCommand & { target: string; label: string })[];

export const NOT_FOUND_OUTPUT = "zsh: command not found: <word>, then a hint pointing at `help`";
