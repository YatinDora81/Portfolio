
import { ThemeProvider } from './components/common/ThemeProvider';
import { CatProvider } from './components/common/CatProvider';
import NekoCat from './components/common/NekoCat';
import Navbar from './components/common/Navbar';
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

function quoteOfDay(quotes: { quote: string; author: string }[]) {
  if (quotes.length === 0) return null;
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayOfYear = Math.floor((today - start) / 86_400_000);
  return quotes[dayOfYear % quotes.length] ?? null;
}

export default async function Home() {
  const [heroData, aboutData, skills, experiences, projects, blogs, quotes, contactData, siteConfig] =
    await Promise.all([
      getHeroData(),
      getAboutData(),
      getSkills(),
      getExperiences(),
      getProjects(),
      getBlogs(),
      getQuotes(),
      getContactData(),
      getSiteConfig(),
    ]);

  // Company marks for the About terminal, reusing the logos already set on the
  // Experience rows so there's only one place in the CMS to maintain them.
  const companyLogos = Object.fromEntries(
    experiences
      .filter((e) => e.logoUrl)
      .map((e) => [e.company.trim().toLowerCase(), e.logoUrl as string])
  );

  // Pick the "thought of the day" on the server (deterministic day-of-year index)
  // so only ONE quote is serialized into the payload instead of all ~28, and there's
  // no post-hydration flash. Stable within the 24h revalidation window.
  const thought = quoteOfDay(quotes);

  return (
    <ThemeProvider>
      <CatProvider>
      <div className="min-h-screen bg-background text-foreground">
        <NekoCat />
        <BackgroundLines />
        <div className="pointer-events-none fixed inset-0 z-[1] bg-background/50 backdrop-blur-[1px]" />
        <div className="relative z-[2]">
          <Navbar logo={siteConfig.navbarLogo} hasBlogs={blogs.length > 0} />
          <main>
            <Hero
              titles={heroData.titles}
              skills={heroData.skills}
              socialLinks={heroData.socialLinks}
              name={siteConfig.name}
              tagline={siteConfig.tagline}
              intro={siteConfig.intro}
              avatarUrl={siteConfig.avatarUrl}
              resumeUrl={siteConfig.resumeUrl}
            />
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
            <ThoughtOfTheDay quote={thought} />
            <Contact
              purposes={contactData.purposes}
              socialLinks={contactData.socialLinks}
              contactEmail={siteConfig.contactEmail}
              availabilityStatus={siteConfig.availabilityStatus}
              availabilityDetail={siteConfig.availabilityDetail}
            />
          </main>
          <Footer copyrightName={siteConfig.copyrightName} />
        </div>
      </div>
      </CatProvider>
    </ThemeProvider>
  );
}

export const revalidate = 86400; // revalidate every 24 hours