
import { after } from 'next/server';
import { ThemeProvider } from './components/common/ThemeProvider';
import { CatProvider } from './components/common/CatProvider';
import MotionProvider from './components/common/MotionProvider';
import Navbar from './components/common/Navbar';
import Bridge from './components/common/Bridge';
import Hero from './components/landing/Hero';
import About from './components/landing/About';
import Skills from './components/landing/Skills';
import Experience from './components/landing/Experience';
import Projects from './components/landing/Projects';
import Blogs from './components/landing/Blogs';
import ThoughtOfTheDay from './components/landing/ThoughtOfTheDay';
import Contact from './components/landing/Contact';
import Footer from './components/common/Footer';
import BackgroundLines from './components/common/BackgroundLines';
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
import { githubHandle, readGithubActivity } from './lib/github';
import { SITE_URL, SITE_NAME, absoluteUrl } from './lib/site';

/** Which quote today lands on, and the date the section prints beside it — both
    off the same UTC midnight so the label can never name a different day than
    the pick. */
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
    // The machine-readable half of the same label, off the same UTC midnight —
    // so the <time> datetime can never name a different day than the printed
    // one or than the pick.
    iso: new Date(today).toISOString().slice(0, 10),
    // The ledger index the section prints beside the date. Leap-aware, or one
    // year in four the denominator is short by a day the numerator can reach.
    day: dayOfYear,
    days: year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365,
  };
}

export default async function Home() {
  // First and alone: it resolves the live hero row, and `heroVersion` scopes
  // every hero query below it.
  const siteConfig = await getSiteConfig();
  const [heroData, aboutData, skills, experiences, projects, blogs, quotes, contactData] =
    await Promise.all([
      getHeroData(siteConfig.heroVersion),
      getAboutData(),
      getSkills(),
      getExperiences(),
      getProjects(),
      getBlogs(),
      getQuotes(),
      getContactData(),
    ]);

  // Company marks for the About terminal, reusing the logos already set on the
  // Experience rows so there's only one place in the CMS to maintain them.
  const companyLogos = Object.fromEntries(
    experiences
      .filter((e) => e.logoUrl)
      .map((e) => [e.company.trim().toLowerCase(), e.logoUrl as string])
  );

  // Picked here so only ONE quote is serialized into the payload instead of all
  // ~28, and the first paint is already the right one.
  const thought = thoughtOfDay(quotes);

  // Real commit activity for the contact section's GitHub tile, read from the
  // archive in Postgres rather than from the upstream mirror. Sequential on
  // purpose: the handle comes out of the social links above.
  const github = await readGithubActivity(contactData.socialLinks);

  // Polled here because there is no cron, and this render already wakes about
  // once a day on the revalidate below. It runs in `after`, so no visitor waits
  // on a third-party service.
  //
  // It goes out over HTTP to the site's own endpoints rather than calling
  // refreshGithubActivity()/revalidatePath() inline, which is what it used to
  // do: in production `/` is fully static, so the render and its `after`
  // callback sit in a prerender work unit where a no-store fetch and
  // revalidatePath both throw DynamicServerError — and `after` swallows them.
  // The mirror was never contacted at all in a production build. A route
  // handler is always a request store, hence this shape.
  //
  // The flush is what makes the poll worth anything: this render already read
  // the archive, so the HTML being cached still shows the previous snapshot.
  const handle = githubHandle(contactData.socialLinks.find((l) => l.iconKey === 'github')?.href);
  if (handle && (!github || github.stale)) {
    after(async () => {
      const secret = process.env.REVALIDATE_SECRET;
      if (!secret) return;
      // No `cache` option, deliberately: an explicit 'no-store' is the thing
      // that marks the scope dynamic and throws, and a POST is uncacheable
      // anyway. `absoluteUrl` aims at SITE_URL, the deployment holding the ISR
      // entry being flushed.
      const post = (path: string) =>
        fetch(absoluteUrl(path), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret }),
          signal: AbortSignal.timeout(20_000),
        });
      // Nothing catches a rejection here. `after` logs it, and after a bug that
      // hid in a swallowed error, a poll that fails should say so.
      if ((await post('/api/github/refresh')).ok) await post('/api/revalidate');
    });
  }

  // Person structured data for rich results (knowledge panel, sameAs linking).
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
    // Hardcoded, not `heroData.titles[0]` — structured data shouldn't flip with
    // a presentational toggle.
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
        <BackgroundLines />
        <div className="pointer-events-none fixed inset-0 z-[1] bg-background/50" />
        <div className="relative z-[2]">
          <Navbar logo={siteConfig.navbarLogo} hasBlogs={blogs.length > 0} />
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
            />
            <Bridge />
            <About
              paragraphs={aboutData.paragraphs}
              education={aboutData.education}
              resumeUrl={siteConfig.resumeUrl}
              companyLogos={companyLogos}
            />
            <Skills skills={skills} />
            <Experience experiences={experiences} />
            <Projects projects={projects} />
            {blogs.length > 0 && <Blogs blogs={blogs} />}
            <ThoughtOfTheDay
              quote={thought.quote}
              date={thought.date}
              iso={thought.iso}
              day={thought.day}
              days={thought.days}
            />
            <Contact
              purposes={contactData.purposes}
              socialLinks={contactData.socialLinks}
              contactEmail={siteConfig.contactEmail}
              availabilityStatus={siteConfig.availabilityStatus}
              availabilityDetail={siteConfig.availabilityDetail}
              resumeUrl={siteConfig.resumeUrl}
              github={github}
            />
          </main>
          <Footer copyrightName={siteConfig.copyrightName} />
        </div>
      </div>
      </MotionProvider>
      </CatProvider>
    </ThemeProvider>
  );
}

export const revalidate = 86400; // revalidate every 24 hours