'use client';

import { useState } from 'react';
import { useTheme } from './ThemeProvider';
import { useCat } from './CatProvider';
import { SunIcon, MoonIcon, PawIcon } from '@repo/ui/icons/brand';
import {
  Navbar as NavbarWrapper,
  NavBody,
  NavItems,
  MobileNav,
  NavbarLogo,
  MobileNavHeader,
  MobileNavToggle,
  MobileNavMenu,
} from '@/components/ui/resizable-navbar';

const MOBILE_MENU_ID = 'mobile-nav-menu';

// `key` is what ties a link to its section's visibility, and it is a literal
// union rather than a string so a rename here becomes a type error at the call
// site instead of a silently-undefined lookup that hides the link forever.
const allNavItems = [
  { key: 'skills', name: 'Skills', link: '#skills' },
  { key: 'experience', name: 'Experience', link: '#experience' },
  { key: 'projects', name: 'Projects', link: '#projects' },
  { key: 'blogs', name: 'Blogs', link: '#blogs' },
  { key: 'contact', name: 'Contact', link: '#contact' },
] as const;

type NavSection = (typeof allNavItems)[number]['key'];

interface NavbarProps {
  logo: string;
  /**
   * Which sections the page actually rendered. Resolved once by the page — the
   * feature flag AND, for blogs, whether there are any posts — because a link
   * to a section that isn't there scrolls nowhere, which reads as a broken site
   * rather than a hidden section.
   */
  sections: Record<NavSection, boolean>;
}

export default function Navbar({ logo, sections }: NavbarProps) {
  const { theme, toggleTheme } = useTheme();
  const { showCat, toggleCat } = useCat();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // One filtered array, feeding both the desktop NavItems and the mobile menu
  // below, so the two can never disagree about what exists.
  const navItems = allNavItems.filter((item) => sections[item.key]);

  return (
    // <header>/<nav> rather than bare divs: the logo, the five section links and
    // the two toggles used to sit outside every landmark, so landmark navigation
    // (NVDA's D, the VoiceOver rotor) offered only "main" and "contentinfo" and
    // no way to reach the site navigation at all.
    <header className="relative w-full">
      <NavbarWrapper>
        <NavBody>
          <NavbarLogo label={logo} />
          <NavItems items={navItems} />
          <div className="flex items-center gap-2">
            <button
              onClick={toggleCat}
              className={`paw-btn relative z-20 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors duration-200 cursor-pointer bg-transparent border-none ${showCat ? 'on' : 'text-black dark:text-white'}`}
              aria-label={showCat ? 'Hide the cat' : 'Show the cat'}
              aria-pressed={showCat}
              title={showCat ? 'Shoo the cat away' : 'Bring the cat back'}
            >
              <span className="paw"><PawIcon filled={showCat} /></span>
            </button>
            <button
              onClick={toggleTheme}
              className="relative z-20 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors duration-200 cursor-pointer bg-transparent border-none text-black dark:text-white"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </NavBody>

        <MobileNav>
          <MobileNavHeader>
            <NavbarLogo label={logo} />
            <div className="flex items-center gap-2">
              <button
                onClick={toggleCat}
                className={`paw-btn p-2 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors duration-200 cursor-pointer bg-transparent border-none ${showCat ? 'on' : 'text-black dark:text-white'}`}
                aria-label={showCat ? 'Hide the cat' : 'Show the cat'}
                aria-pressed={showCat}
                title={showCat ? 'Shoo the cat away' : 'Bring the cat back'}
              >
                <span className="paw"><PawIcon filled={showCat} /></span>
              </button>
              <button
                onClick={toggleTheme}
                className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors duration-200 cursor-pointer bg-transparent border-none text-black dark:text-white"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              </button>
              <MobileNavToggle
                isOpen={isMobileMenuOpen}
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              />
            </div>
          </MobileNavHeader>

          <MobileNavMenu
            id={MOBILE_MENU_ID}
            isOpen={isMobileMenuOpen}
            onClose={() => setIsMobileMenuOpen(false)}
          >
            {navItems.map((item, idx) => (
              <a
                key={`mobile-link-${idx}`}
                href={item.link}
                onClick={() => setIsMobileMenuOpen(false)}
                className="relative text-neutral-600 dark:text-neutral-300"
              >
                <span className="block">{item.name}</span>
              </a>
            ))}
          </MobileNavMenu>
        </MobileNav>
      </NavbarWrapper>
    </header>
  );
}
