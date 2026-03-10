# Portfolio

A full-stack, database-driven portfolio platform with a public website and an admin dashboard CMS — built as a Turborepo monorepo.

**Live:** [yatindora.in](https://yatindora.in)
**Repo:** [github.com/YatinDora81/Portfolio](https://github.com/YatinDora81/Portfolio)

## Tech Stack

- **Monorepo:** Turborepo + Bun
- **Framework:** Next.js 16 (React 19)
- **Language:** TypeScript
- **Styling:** Tailwind CSS 4
- **Database:** PostgreSQL (Neon) + Prisma ORM
- **Auth:** JWT (jose) + bcrypt + Email OTP
- **Email:** Nodemailer (Gmail)
- **Animations:** Motion.js
- **Icons:** Tabler Icons

## Project Structure

```
portfolio/
├── apps/
│   ├── web/          # Public portfolio website
│   └── docs/         # Admin dashboard CMS
├── packages/
│   ├── db/           # Prisma schema, migrations & client
│   ├── ui/           # Shared React components
│   ├── eslint-config/
│   └── typescript-config/
├── turbo.json
└── package.json
```

## Apps

### Web (`apps/web`)

The public-facing portfolio at [yatindora.in](https://yatindora.in).

**Pages:**
- `/` — Landing page with all sections (Hero, About, Skills, Experience, Projects, Blogs, Contact)
- `/blog/[slug]` — Individual blog post

**Features:**
- Server-side rendering with async data fetching
- ISR with 24-hour cache + manual revalidation from admin
- Dark/light theme toggle
- Animated hero with rotating titles & skill badges
- Contact form with purpose selection
- Responsive design
- Easter egg cat companion (NekoCat)

### Docs (`apps/docs`)

Admin dashboard CMS for managing all portfolio content.

**Manages:**
- Hero titles & skill badges
- About paragraphs & education
- Social links & resume
- Skills (with visibility toggle)
- Work experience (with bullet points)
- Projects (with bullet points & images)
- Blog posts (with visibility toggle)
- Quotes / Thought of the Day
- Contact form purposes
- Incoming messages (inbox)
- Site configuration (name, tagline, avatar, etc.)
- Admin users & roles

**Auth Features:**
- JWT-based session (httpOnly cookies, 7-day expiry)
- 3-strike password lockout → email OTP fallback
- Password reset via email link
- Role-based access (Owner, Admin, Sub-Admin)

## Packages

| Package | Description |
|---------|-------------|
| `db` | Prisma schema (18 models), migrations, and shared database client |
| `ui` | Shared React component library (Button, Card, Code) |
| `eslint-config` | Shared ESLint configuration |
| `typescript-config` | Shared TypeScript configuration |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.3.7+)
- PostgreSQL database (or [Neon](https://neon.tech) account)

### Setup

```bash
# Clone the repo
git clone https://github.com/YatinDora81/Portfolio.git
cd Portfolio

# Install dependencies
bun install

# Set up environment variables
cp apps/web/.env.example apps/web/.env
cp apps/docs/.env.example apps/docs/.env
```

### Environment Variables

**Web App (`apps/web/.env`):**
```env
DATABASE_URL=
REVALIDATE_SECRET=
```

**Docs App (`apps/docs/.env`):**
```env
DATABASE_URL=
JWT_SECRET=
SMTP_EMAIL=
SMTP_PASSWORD=
PORTFOLIO_URL=
REVALIDATE_SECRET=
```

### Database

```bash
# Push schema to database
cd packages/db && bunx prisma db push

# Generate Prisma client
bunx prisma generate

# Seed the database (optional)
bun run seed
```

### Development

```bash
# Run all apps
bun run dev

# Web app: http://localhost:3000
# Docs app: http://localhost:3001
```

### Build

```bash
bun run build
```

## Database Models

**Content:** HeroTitle, HeroSkillBadge, SocialLink, AboutParagraph, Education, Skill, Experience, ExperienceBullet, Project, ProjectBullet, Blog, Quote, ContactPurpose, ContactMessage, SiteConfig

**Admin:** AdminUser (with roles: Owner, Admin, Sub-Admin)

**Relationships:**
- Skill ↔ Experience (many-to-many)
- Skill ↔ Project (many-to-many)
- Experience → ExperienceBullet (one-to-many, cascade delete)
- Project → ProjectBullet (one-to-many, cascade delete)

## How It Works

1. **Admin** logs into the Docs app and manages content via the dashboard
2. On save, the Docs app updates the database and triggers ISR revalidation on the Web app
3. **Web app** fetches fresh data from the database and renders the portfolio
4. Visitors see the updated content at [yatindora.in](https://yatindora.in)
