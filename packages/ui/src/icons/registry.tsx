import type { ReactNode } from "react";
import {
  ReactIcon, NextJsIcon, NodeJsIcon, ExpressIcon, TypeScriptIcon, JavaScriptIcon,
  GoIcon, PostgreSQLIcon, MySQLIcon, MongoDBIcon, RedisIcon, PrismaIcon, DrizzleIcon,
  DockerIcon, GitIcon, GitHubSkillIcon, TurboRepoIcon, CICDIcon, WebSocketIcon,
  JavaIcon, JenkinsIcon, KafkaIcon, AWSIcon, SQLIcon, DSAIcon, OOPsIcon,
  RestAPIIcon, MonitorIcon, LogIcon, TailwindIcon, ZodIcon, JestIcon, SeleniumIcon,
  JiraIcon, VercelIcon, LinuxIcon, NginxIcon, HtmlCssIcon, ReduxIcon, ZustandIcon,
  JwtIcon, OAuthIcon, ClerkIcon, PostmanIcon, SwaggerIcon, EslintPrettierIcon,
  S3Icon, EC2Icon, CloudflareIcon, BashIcon, NpmIcon, AgileIcon, NotionIcon,
  GoogleApisIcon, PythonIcon, FastAPIIcon, FlaskIcon, GeminiIcon, BunIcon, CloudflareR2Icon,
} from "./skills";
import { GithubIcon, LinkedInIcon, MailIcon, LeetCodeIcon, XIcon } from "./brand";

export const ICON_GROUPS = [
  "Languages",
  "Frontend",
  "Backend",
  "Databases & ORM",
  "AI & LLM",
  "DevOps & Cloud",
  "Testing & Quality",
  "Auth",
  "Tools & Practices",
] as const;

export type IconGroup = (typeof ICON_GROUPS)[number];

export interface SkillIconEntry {
  key: string;
  group: IconGroup;
  aliases?: string[];
  Icon: () => ReactNode;
  search?: string;
}

export const SKILL_ICONS: SkillIconEntry[] = [
  { key: "TypeScript", group: "Languages", Icon: TypeScriptIcon, search: "ts" },
  { key: "JavaScript", group: "Languages", Icon: JavaScriptIcon, search: "js ecmascript" },
  { key: "Java", group: "Languages", Icon: JavaIcon },
  { key: "Python", group: "Languages", Icon: PythonIcon, search: "py fastapi ml ai" },
  { key: "Go", group: "Languages", Icon: GoIcon, search: "golang" },
  { key: "SQL", group: "Languages", Icon: SQLIcon, search: "query" },
  { key: "Bash", group: "Languages", Icon: BashIcon, search: "shell sh zsh terminal" },
  { key: "HTML/CSS", group: "Languages", Icon: HtmlCssIcon, search: "html5 css3 markup" },

  { key: "React", group: "Frontend", aliases: ["React.js"], Icon: ReactIcon },
  { key: "Next.js", group: "Frontend", Icon: NextJsIcon, search: "nextjs vercel framework" },
  { key: "Tailwind CSS", group: "Frontend", Icon: TailwindIcon, search: "tailwindcss utility" },
  { key: "Redux", group: "Frontend", Icon: ReduxIcon, search: "state store" },
  { key: "Zustand", group: "Frontend", Icon: ZustandIcon, search: "state store" },

  { key: "Node.js", group: "Backend", Icon: NodeJsIcon, search: "nodejs" },
  { key: "Express.js", group: "Backend", Icon: ExpressIcon, search: "expressjs" },
  { key: "REST APIs", group: "Backend", Icon: RestAPIIcon, search: "rest api http endpoint" },
  { key: "WebSocket", group: "Backend", aliases: ["WebSockets"], Icon: WebSocketIcon, search: "ws realtime socket" },
  { key: "Kafka", group: "Backend", Icon: KafkaIcon, search: "queue stream events" },
  { key: "Zod", group: "Backend", Icon: ZodIcon, search: "validation schema" },
  { key: "FastAPI", group: "Backend", Icon: FastAPIIcon, search: "python asgi uvicorn api" },
  { key: "Flask", group: "Backend", Icon: FlaskIcon, search: "python wsgi jinja micro api" },

  { key: "PostgreSQL", group: "Databases & ORM", Icon: PostgreSQLIcon, search: "postgres pg" },
  { key: "MySQL", group: "Databases & ORM", Icon: MySQLIcon },
  { key: "MongoDB", group: "Databases & ORM", Icon: MongoDBIcon, search: "mongo nosql" },
  { key: "Redis", group: "Databases & ORM", Icon: RedisIcon, search: "cache kv" },
  { key: "Prisma", group: "Databases & ORM", Icon: PrismaIcon, search: "orm" },
  { key: "Drizzle", group: "Databases & ORM", aliases: ["Drizzle ORM"], Icon: DrizzleIcon, search: "orm" },

  { key: "Gemini", group: "AI & LLM", Icon: GeminiIcon, search: "google llm ai model" },

  { key: "Docker", group: "DevOps & Cloud", Icon: DockerIcon, search: "container" },
  { key: "AWS", group: "DevOps & Cloud", Icon: AWSIcon, search: "amazon cloud" },
  { key: "AWS S3", group: "DevOps & Cloud", Icon: S3Icon, search: "amazon bucket storage" },
  { key: "AWS EC2", group: "DevOps & Cloud", Icon: EC2Icon, search: "amazon compute instance" },
  { key: "Cloudflare", group: "DevOps & Cloud", Icon: CloudflareIcon, search: "cdn dns edge" },
  { key: "Cloudflare R2", group: "DevOps & Cloud", Icon: CloudflareR2Icon, search: "object storage bucket s3" },
  { key: "Vercel", group: "DevOps & Cloud", Icon: VercelIcon, search: "hosting deploy" },
  { key: "Linux", group: "DevOps & Cloud", Icon: LinuxIcon, search: "unix ubuntu server" },
  { key: "Nginx", group: "DevOps & Cloud", Icon: NginxIcon, search: "proxy webserver" },
  { key: "Jenkins", group: "DevOps & Cloud", Icon: JenkinsIcon, search: "build pipeline" },
  { key: "CI/CD", group: "DevOps & Cloud", Icon: CICDIcon, search: "pipeline continuous integration deployment" },
  { key: "Turborepo", group: "DevOps & Cloud", Icon: TurboRepoIcon, search: "monorepo turbo build" },
  { key: "Monitoring", group: "DevOps & Cloud", Icon: MonitorIcon, search: "observability metrics uptime" },
  { key: "Logging", group: "DevOps & Cloud", Icon: LogIcon, search: "logs observability" },

  { key: "Jest", group: "Testing & Quality", Icon: JestIcon, search: "test unit" },
  { key: "Selenium", group: "Testing & Quality", Icon: SeleniumIcon, search: "test e2e browser" },
  { key: "ESLint", group: "Testing & Quality", Icon: EslintPrettierIcon, search: "lint prettier format" },
  { key: "Postman", group: "Testing & Quality", Icon: PostmanIcon, search: "api client test" },
  { key: "Swagger", group: "Testing & Quality", Icon: SwaggerIcon, search: "openapi docs api" },

  { key: "JWT", group: "Auth", Icon: JwtIcon, search: "token json web auth" },
  { key: "OAuth", group: "Auth", Icon: OAuthIcon, search: "sso login auth" },
  { key: "Clerk", group: "Auth", Icon: ClerkIcon, search: "auth login users" },

  { key: "Git", group: "Tools & Practices", Icon: GitIcon, search: "version control" },
  { key: "GitHub", group: "Tools & Practices", aliases: ["GitHub Actions"], Icon: GitHubSkillIcon, search: "git repo actions" },
  { key: "npm/yarn", group: "Tools & Practices", Icon: NpmIcon, search: "package manager pnpm" },
  { key: "Bun", group: "Tools & Practices", Icon: BunIcon, search: "runtime package manager bunjs" },
  { key: "Jira", group: "Tools & Practices", Icon: JiraIcon, search: "tickets atlassian" },
  { key: "Notion", group: "Tools & Practices", Icon: NotionIcon, search: "docs notes" },
  { key: "Agile", group: "Tools & Practices", Icon: AgileIcon, search: "scrum sprint kanban" },
  { key: "DSA", group: "Tools & Practices", Icon: DSAIcon, search: "algorithms data structures" },
  { key: "OOPs", group: "Tools & Practices", Icon: OOPsIcon, search: "object oriented design" },
  { key: "Google APIs", group: "Tools & Practices", Icon: GoogleApisIcon, search: "sheets gcp oauth" },
];

export interface SocialIconEntry {
  key: string;
  label: string;
  aliases?: string[];
  Icon: (props: { className?: string }) => ReactNode;
  search?: string;
}

export const SOCIAL_ICONS: SocialIconEntry[] = [
  { key: "github", label: "GitHub", Icon: GithubIcon, search: "code repo" },
  { key: "linkedin", label: "LinkedIn", Icon: LinkedInIcon, search: "work profile" },
  { key: "x", label: "X (Twitter)", aliases: ["twitter"], Icon: XIcon, search: "twitter tweet" },
  { key: "leetcode", label: "LeetCode", Icon: LeetCodeIcon, search: "dsa problems" },
  { key: "email", label: "Email", Icon: MailIcon, search: "mail contact" },
];

export const skillIconMap: Record<string, ReactNode> = Object.fromEntries(
  SKILL_ICONS.flatMap(({ key, aliases, Icon }) => {
    const el = <Icon />;
    return [key, ...(aliases ?? [])].map((k) => [k, el] as const);
  })
);

export const socialIconMap: Record<string, (props: { className?: string }) => ReactNode> =
  Object.fromEntries(
    SOCIAL_ICONS.flatMap(({ key, aliases, Icon }) =>
      [key, ...(aliases ?? [])].map((k) => [k, Icon] as const)
    )
  );

export function findSkillIcon(key: string): SkillIconEntry | undefined {
  const needle = key.trim().toLowerCase();
  return SKILL_ICONS.find(
    (e) => [e.key, ...(e.aliases ?? [])].some((k) => k.toLowerCase() === needle)
  );
}

export function findSocialIcon(key: string): SocialIconEntry | undefined {
  const needle = key.trim().toLowerCase();
  return SOCIAL_ICONS.find(
    (e) => [e.key, ...(e.aliases ?? [])].some((k) => k.toLowerCase() === needle)
  );
}

export function matchesIconQuery(
  entry: { key: string; label?: string; aliases?: string[]; group?: string; search?: string },
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [entry.key, entry.label, entry.group, entry.search, ...(entry.aliases ?? [])]
    .filter(Boolean)
    .some((s) => (s as string).toLowerCase().includes(q));
}
