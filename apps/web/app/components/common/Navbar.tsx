'use client';

import { useState } from 'react';
import { useTheme } from './ThemeProvider';
import { SunIcon, MoonIcon } from '../icons';
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

const allNavItems = [
  { name: 'Skills', link: '#skills' },
  { name: 'Experience', link: '#experience' },
  { name: 'Projects', link: '#projects' },
  { name: 'Blogs', link: '#blogs' },
  { name: 'Contact', link: '#contact' },
];

export default function Navbar({ logo, hasBlogs }: { logo: string; hasBlogs: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navItems = hasBlogs ? allNavItems : allNavItems.filter(item => item.name !== 'Blogs');

  return (
    <div className="relative w-full">
      <NavbarWrapper>
        <NavBody>
          <NavbarLogo label={logo} />
          <NavItems items={navItems} />
          <div className="flex items-center gap-4">
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
    </div>
  );
}
