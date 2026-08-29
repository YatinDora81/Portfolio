'use client';

import { useState, type MouseEvent } from 'react';
import { useTheme } from './ThemeProvider';
import { useCat } from './CatProvider';
import { OPEN_EVENT } from './CommandMenu';
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

const ICON_BTN =
  'nav-ib relative z-20 flex size-9 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-foreground transition-colors duration-200 hover:bg-muted';

function ThemeButton() {
  const { toggleTheme } = useTheme();
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };
  return (
    <button type="button" onClick={onClick} data-theme-toggle="" className={`${ICON_BTN} tt`} aria-label="Toggle theme">
      <span className="tt-moon" aria-hidden="true"><MoonIcon /></span>
      <span className="tt-sun" aria-hidden="true"><SunIcon /></span>
    </button>
  );
}

function CatButton() {
  const { showCat, toggleCat } = useCat();
  return (
    <button
      type="button"
      onClick={toggleCat}
      className={`${ICON_BTN} paw-btn${showCat ? ' on' : ''}`}
      aria-label={showCat ? 'Hide the cat' : 'Show the cat'}
      aria-pressed={showCat}
      title={showCat ? 'Shoo the cat away' : 'Bring the cat back'}
    >
      <span className="paw"><PawIcon filled={showCat} /></span>
    </button>
  );
}

function SearchButton() {
  return (
    <button
      type="button"
      className="kbtn hidden items-center gap-1.5 lg:inline-flex"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT))}
      aria-label="Open command menu (⌘K)"
    >
      search <kbd className="kbd">⌘K</kbd>
    </button>
  );
}

export default function Navbar({ logo, sections }: NavbarProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navItems = allNavItems.filter((item) => sections[item.key]);

  return (
    <header className="relative w-full">
      <NavbarWrapper>
        <NavBody>
          <NavbarLogo label={logo} />
          <NavItems items={navItems} />
          <div className="flex items-center gap-2">
            <SearchButton />
            <CatButton />
            <ThemeButton />
          </div>
        </NavBody>

        <MobileNav>
          <MobileNavHeader>
            <NavbarLogo label={logo} />
            <div className="flex items-center gap-2">
              <CatButton />
              <ThemeButton />
              <MobileNavToggle isOpen={isMobileMenuOpen} onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} />
            </div>
          </MobileNavHeader>

          <MobileNavMenu id={MOBILE_MENU_ID} isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)}>
            {navItems.map((item, idx) => (
              <a key={`mobile-link-${idx}`} href={item.link} onClick={() => setIsMobileMenuOpen(false)} className="relative text-secondary-ink">
                <span className="block">{item.name}</span>
              </a>
            ))}
          </MobileNavMenu>
        </MobileNav>
      </NavbarWrapper>
    </header>
  );
}
