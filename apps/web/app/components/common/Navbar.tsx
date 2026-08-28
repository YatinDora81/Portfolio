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
  { key: 'skills', name: 'Skills', link: '#skills' },
  { key: 'experience', name: 'Experience', link: '#experience' },
  { key: 'projects', name: 'Projects', link: '#projects' },
  { key: 'blogs', name: 'Blogs', link: '#blogs' },
  { key: 'contact', name: 'Contact', link: '#contact' },
] as const;

type NavSection = (typeof allNavItems)[number]['key'];

interface NavbarProps {
  logo: string;
  sections: Record<NavSection, boolean>;
}

export default function Navbar({ logo, sections }: NavbarProps) {
  const { theme, toggleTheme } = useTheme();
  const { showCat, toggleCat } = useCat();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navItems = allNavItems.filter((item) => sections[item.key]);

  return (
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
