export type SkillCategoryId =
  | 'frontend'
  | 'backend'
  | 'database'
  | 'devops'
  | 'core';

export interface SkillCategory {
  id: SkillCategoryId;
  label: string;
  color: string;
}

export const skillCategories: SkillCategory[] = [
  { id: 'frontend', label: 'Frontend', color: '#38BDF8' },
  { id: 'backend', label: 'Backend', color: '#34D399' },
  { id: 'database', label: 'Databases', color: '#FBBF24' },
  { id: 'devops', label: 'DevOps & Cloud', color: '#A78BFA' },
  { id: 'core', label: 'CS & Tooling', color: '#F472B6' },
];

export interface SkillMeta {
  symbol: string;
  color: string;
  category: SkillCategoryId;
}

const META: Record<string, SkillMeta> = {
  'Next.js': { symbol: 'Nx', color: '#E5E5E5', category: 'frontend' },
  React: { symbol: 'Re', color: '#61DAFB', category: 'frontend' },
  'React.js': { symbol: 'Re', color: '#61DAFB', category: 'frontend' },
  TypeScript: { symbol: 'Ts', color: '#3178C6', category: 'frontend' },
  JavaScript: { symbol: 'Js', color: '#F7DF1E', category: 'frontend' },
  Redux: { symbol: 'Rx', color: '#764ABC', category: 'frontend' },
  Zustand: { symbol: 'Zu', color: '#A855F7', category: 'frontend' },
  'Tailwind CSS': { symbol: 'Tw', color: '#38BDF8', category: 'frontend' },
  'HTML/CSS': { symbol: 'Ht', color: '#E34F26', category: 'frontend' },

  'Node.js': { symbol: 'No', color: '#8CC84B', category: 'backend' },
  'Express.js': { symbol: 'Ex', color: '#9CA3AF', category: 'backend' },
  Go: { symbol: 'Go', color: '#00ADD8', category: 'backend' },
  Golang: { symbol: 'Go', color: '#00ADD8', category: 'backend' },
  'REST APIs': { symbol: 'Ap', color: '#34D399', category: 'backend' },
  WebSockets: { symbol: 'Ws', color: '#EC4899', category: 'backend' },
  WebSocket: { symbol: 'Ws', color: '#EC4899', category: 'backend' },
  Kafka: { symbol: 'Kf', color: '#D1D5DB', category: 'backend' },
  Java: { symbol: 'Jv', color: '#E76F00', category: 'backend' },
  Python: { symbol: 'Py', color: '#3776AB', category: 'backend' },
  FastAPI: { symbol: 'Fa', color: '#009688', category: 'backend' },
  // flask's brand mark is black, invisible on the dark surface
  Flask: { symbol: 'Fl', color: '#9CA3AF', category: 'backend' },

  PostgreSQL: { symbol: 'Pg', color: '#4F9DDE', category: 'database' },
  MongoDB: { symbol: 'Mo', color: '#47A248', category: 'database' },
  MySQL: { symbol: 'My', color: '#4479A1', category: 'database' },
  Redis: { symbol: 'Rd', color: '#DC382D', category: 'database' },
  Prisma: { symbol: 'Pr', color: '#2DD4BF', category: 'database' },
  Drizzle: { symbol: 'Dz', color: '#C5F74F', category: 'database' },
  'Drizzle ORM': { symbol: 'Dz', color: '#C5F74F', category: 'database' },
  SQL: { symbol: 'Sq', color: '#38BDF8', category: 'database' },

  Docker: { symbol: 'Dk', color: '#2496ED', category: 'devops' },
  AWS: { symbol: 'Aw', color: '#FF9900', category: 'devops' },
  'AWS S3': { symbol: 'S3', color: '#E25444', category: 'devops' },
  'AWS EC2': { symbol: 'Ec', color: '#FF9900', category: 'devops' },
  'CI/CD': { symbol: 'Ci', color: '#A78BFA', category: 'devops' },
  'GitHub Actions': { symbol: 'Ga', color: '#2088FF', category: 'devops' },
  Jenkins: { symbol: 'Je', color: '#D24939', category: 'devops' },
  Nginx: { symbol: 'Ng', color: '#009639', category: 'devops' },
  Cloudflare: { symbol: 'Cf', color: '#F38020', category: 'devops' },
  'Cloudflare R2': { symbol: 'R2', color: '#F38020', category: 'devops' },
  Vercel: { symbol: 'Vc', color: '#E5E5E5', category: 'devops' },
  Linux: { symbol: 'Lx', color: '#FCC624', category: 'devops' },
  Monitoring: { symbol: 'Mn', color: '#F59E0B', category: 'devops' },
  Logging: { symbol: 'Lg', color: '#A3A3A3', category: 'devops' },

  DSA: { symbol: 'Ds', color: '#F472B6', category: 'core' },
  OOPs: { symbol: 'Oo', color: '#C084FC', category: 'core' },
  Git: { symbol: 'Gt', color: '#F05032', category: 'core' },
  GitHub: { symbol: 'Gh', color: '#E5E5E5', category: 'core' },
  Turborepo: { symbol: 'Tr', color: '#EF4444', category: 'core' },
  Jest: { symbol: 'Jt', color: '#C21325', category: 'core' },
  Selenium: { symbol: 'Se', color: '#43B02A', category: 'core' },
  Jira: { symbol: 'Ji', color: '#2684FF', category: 'core' },
  Postman: { symbol: 'Pm', color: '#FF6C37', category: 'core' },
  Notion: { symbol: 'Nt', color: '#E5E5E5', category: 'core' },
  'npm/yarn': { symbol: 'Np', color: '#CB3837', category: 'core' },
  Bash: { symbol: 'Bs', color: '#4EAA25', category: 'core' },
  Agile: { symbol: 'Ag', color: '#22C55E', category: 'core' },
  Gemini: { symbol: 'Ge', color: '#4796E3', category: 'core' },
  Bun: { symbol: 'Bn', color: '#FBF0DF', category: 'core' },
};

const CATEGORY_COLOR: Record<SkillCategoryId, string> = Object.fromEntries(
  skillCategories.map((c) => [c.id, c.color]),
) as Record<SkillCategoryId, string>;

function deriveSymbol(name: string): string {
  const letters = name.replace(/[^a-zA-Z0-9]/g, '');
  if (letters.length === 0) return '??';
  const first = letters.charAt(0).toUpperCase();
  const second = letters.charAt(1).toLowerCase();
  return first + second;
}

export function getSkillMeta(name: string): SkillMeta {
  const hit = META[name];
  if (hit) return hit;
  return {
    symbol: deriveSymbol(name),
    color: CATEGORY_COLOR.core,
    category: 'core',
  };
}
