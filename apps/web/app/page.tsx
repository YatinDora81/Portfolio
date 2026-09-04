import { Suspense } from 'react';
import { after } from 'next/server';
import { draftMode } from 'next/headers';
import { ThemeProvider } from './components/common/ThemeProvider';
import { CatProvider } from './components/common/CatProvider';
import MotionProvider from './components/common/MotionProvider';
import Navbar from './components/common/Navbar';
import CommandMenu from './components/common/CommandMenu';
import Tuner from './components/common/Tuner';
import Bridge from './components/common/Bridge';
import Hero from './components/landing/Hero';
import About from './components/landing/About';
import Skills from './components/landing/Skills';
import type { UsedIn, UsedInMap } from './components/landing/Skills';
import Experience from './components/landing/Experience';
import Projects from './components/landing/Projects';
import Blogs from './components/landing/Blogs';
import ThoughtOfTheDay from './components/landing/ThoughtOfTheDay';
import Contact from './components/landing/Contact';
import Footer from './components/common/Footer';
import HydrateWhenVisible from './components/common/HydrateWhenVisible';
import Background from './components/common/Background';
import {
  getHeroData,
  getAboutData,
  getSkills,
  getExperiences,
  getProjects,
  getBlogs,
  getQuotes,
  getContactData,
  getSiteConfig,
} from './lib/data';
import { getFlags } from './lib/flags';
import { FLAG_KEYS, flagValue } from '@repo/shared/flags';
import { env } from '@repo/config/env';
import { githubHandle, readGithubActivity } from './lib/github';
import { SITE_URL, SITE_NAME, absoluteUrl } from './lib/site';
import { canonicalSkill, slugify } from './lib/utils';

function thoughtOfDay(quotes: { quote: string; author: string }[]) {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayOfYear = Math.floor((today - start) / 86_400_000);
  const year = now.getUTCFullYear();
  return {
    quote: quotes.length > 0 ? quotes[dayOfYear % quotes.length] ?? null : null,
    date: new Date(today)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
      .toLowerCase(),
    iso: new Date(today).toISOString().slice(0, 10),
    day: dayOfYear,
    days: year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365,
  };
}

export default async function Home() {
  const siteConfig = await getSiteConfig();
  // reading .isEnabled keeps the route static
  const { isEnabled: isPreview } = await draftMode();
  const [heroData, aboutData, skills, experiences, projects, blogs, quotes, contactData, flags] =
    await Promise.all([
      getHeroData(siteConfig.heroVersion),
      getAboutData(),
      getSkills(),
      getExperiences(),
      getProjects(isPreview),
      getBlogs(isPreview),
      getQuotes(),
      getContactData(),
      getFlags(),
    ]);

  const show = {
    about: flagValue(flags, FLAG_KEYS.SECTION_ABOUT),
    skills: flagValue(flags, FLAG_KEYS.SECTION_SKILLS),
    experience: flagValue(flags, FLAG_KEYS.SECTION_EXPERIENCE),
    projects: flagValue(flags, FLAG_KEYS.SECTION_PROJECTS),
    blogs: flagValue(flags, FLAG_KEYS.SECTION_BLOGS) && blogs.length > 0,
    contact: flagValue(flags, FLAG_KEYS.SECTION_CONTACT),
  };

  // hides only the form; the POST endpoint re-checks this flag
  const contactFormEnabled = flagValue(flags, FLAG_KEYS.CONTACT_FORM);

  const companyLogos = Object.fromEntries(
    experiences
      .filter((e) => e.logoUrl)
      .map((e) => [e.company.trim().toLowerCase(), e.logoUrl as string])
  );

  const usedIn: UsedInMap = {};
  const add = (skill: string, entry: UsedIn) => {
    const list = (usedIn[canonicalSkill(skill)] ??= []);
    if (!list.some((u) => u.href === entry.href)) list.push(entry);
  };
  if (show.experience)
    for (const e of experiences)
      for (const t of e.technologies)
        add(t, {
          name: e.company,
          href: `#xp-${slugify(e.company)}`,
          logoUrl: e.logoUrl,
          kind: 'job',
        });
  if (show.projects)
    for (const p of projects)
      for (const t of p.technologies)
        add(t.name, {
          name: p.title,
          href: `#pj-${slugify(p.title)}`,
          logoUrl: p.logoUrl,
          kind: 'build',
        });

  const thought = thoughtOfDay(quotes);

  const github = await readGithubActivity(contactData.socialLinks);

  const handle = githubHandle(contactData.socialLinks.find((l) => l.iconKey === 'github')?.href);
  if (handle && (!github || github.stale)) {
    after(async () => {
      const secret = process.env.REVALIDATE_SECRET;
      if (!secret) return;
      const post = (path: string) =>
        fetch(absoluteUrl(path), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret }),
          signal: AbortSignal.timeout(20_000),
        });
      if ((await post('/api/github/refresh')).ok) await post('/api/revalidate');
    });
  }

  const sameAs = Array.from(
    new Set(
      [...heroData.socialLinks, ...contactData.socialLinks]
        .map((l) => l.href)
        .filter((href): href is string => Boolean(href))
    )
  );
  const personLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: siteConfig.name || SITE_NAME,
    url: SITE_URL,
    ...(siteConfig.avatarUrl ? { image: absoluteUrl(siteConfig.avatarUrl) } : {}),
    jobTitle: "Software Developer",
    ...(sameAs.length ? { sameAs } : {}),
  };

  return (
    <ThemeProvider>
      <CatProvider>
      <MotionProvider>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personLd) }}
      />
      <div className="min-h-screen bg-background text-foreground">
        <Background />
        <div className="relative z-[2]">
          <Navbar logo={siteConfig.navbarLogo} sections={show} />
          <CommandMenu
            sections={show}
            contactEmail={siteConfig.contactEmail}
            resumeUrl={siteConfig.resumeUrl}
            builds={projects.map((p) => ({ title: p.title, live: p.live }))}
          />
          <Tuner sections={show} />
          <main>
            <Hero
              version={siteConfig.heroVersion}
              titles={heroData.titles}
              skills={heroData.skills}
              socialLinks={heroData.socialLinks}
              totalSkills={skills.length}
              name={siteConfig.name}
              tagline={siteConfig.tagline}
              intro={siteConfig.intro}
              avatarUrl={siteConfig.avatarUrl}
              photos={siteConfig.heroPhotos}
              resumeUrl={siteConfig.resumeUrl}
              availabilityStatus={siteConfig.availabilityStatus}
              dotColor={siteConfig.heroDotColor}
              dotPulse={siteConfig.heroDotPulse}
              showAbout={show.about}
              showSkills={show.skills}
              showContact={show.contact}
            />
            <Bridge />
            {show.about && (
              <Suspense fallback={null}>
                <HydrateWhenVisible id="hy-about">
                <About
                  paragraphs={aboutData.paragraphs}
                  education={aboutData.education}
                  resumeUrl={siteConfig.resumeUrl}
                  companyLogos={companyLogos}
                />
                </HydrateWhenVisible>
              </Suspense>
            )}
            {show.skills && (
              <Suspense fallback={null}>
                <HydrateWhenVisible id="hy-skills">
                <Skills skills={skills} usedIn={usedIn} />
                </HydrateWhenVisible>
              </Suspense>
            )}
            {show.experience && (
              <Suspense fallback={null}>
                <HydrateWhenVisible id="hy-experience">
                <Experience experiences={experiences} />
                </HydrateWhenVisible>
              </Suspense>
            )}
            {show.projects && (
              <Suspense fallback={null}>
                <HydrateWhenVisible id="hy-projects">
                <Projects version={siteConfig.projectsVersion} projects={projects} />
                </HydrateWhenVisible>
              </Suspense>
            )}
            {show.blogs && (
              <Suspense fallback={null}>
                <HydrateWhenVisible id="hy-blogs">
                <Blogs blogs={blogs} />
                </HydrateWhenVisible>
              </Suspense>
            )}
            <Suspense fallback={null}>
                <HydrateWhenVisible id="hy-thoughtoftheday">
              <ThoughtOfTheDay
                quote={thought.quote}
                date={thought.date}
                iso={thought.iso}
                day={thought.day}
                days={thought.days}
              />
                </HydrateWhenVisible>
              </Suspense>
            {show.contact && (
              <Suspense fallback={null}>
                <HydrateWhenVisible id="hy-contact">
                <Contact
                  purposes={contactData.purposes}
                  socialLinks={contactData.socialLinks}
                  contactEmail={siteConfig.contactEmail}
                  availabilityStatus={siteConfig.availabilityStatus}
                  availabilityDetail={siteConfig.availabilityDetail}
                  resumeUrl={siteConfig.resumeUrl}
                  github={github}
                  formEnabled={contactFormEnabled}
                  turnstileSiteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null}
                />
                </HydrateWhenVisible>
              </Suspense>
            )}
          </main>
          <Suspense fallback={null}>
                <HydrateWhenVisible id="hy-footer">
            <Footer copyrightName={siteConfig.copyrightName} />
                </HydrateWhenVisible>
              </Suspense>
        </div>
      </div>
      </MotionProvider>
      </CatProvider>
    </ThemeProvider>
  );
}

export const revalidate = 86400;
