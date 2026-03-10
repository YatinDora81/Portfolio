
import { ThemeProvider } from './components/common/ThemeProvider';
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

  return (
    <ThemeProvider>
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
            />
            <Skills skills={skills} />
            <Experience experiences={experiences} />
            <Projects projects={projects} />
            {blogs.length > 0 && <Blogs blogs={blogs} />}
            <ThoughtOfTheDay quotes={quotes} />
            <Contact
              purposes={contactData.purposes}
              socialLinks={contactData.socialLinks}
              contactEmail={siteConfig.contactEmail}
              availabilityStatus={siteConfig.availabilityStatus}
              availabilityDetail={siteConfig.availabilityDetail}
            />
          </main>
          <Footer socialLinks={contactData.socialLinks} copyrightName={siteConfig.copyrightName} />
        </div>
      </div>
    </ThemeProvider>
  );
}

export const revalidate = 86400; // revalidate every 24 hours