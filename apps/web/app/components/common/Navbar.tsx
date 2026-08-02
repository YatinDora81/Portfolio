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

const allNavItems = [
  { name: 'Skills', link: '#skills' },
  { name: 'Experience', link: '#experience' },
  { name: 'Projects', link: '#projects' },
  { name: 'Blogs', link: '#blogs' },
  { name: 'Contact', link: '#contact' },
];

export default function Navbar({ logo, hasBlogs }: { logo: string; hasBlogs: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const { showCat, toggleCat } = useCat();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navItems = hasBlogs ? allNavItems : allNavItems.filter(item => item.name !== 'Blogs');

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
