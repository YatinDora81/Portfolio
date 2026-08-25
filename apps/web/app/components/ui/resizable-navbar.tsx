'use client';

import { cn } from '@/lib/utils';
import { IconMenu2, IconX } from '@tabler/icons-react';
import React, { useEffect, useRef, useState } from 'react';

/**
 * The docking navbar, without Motion.
 *
 * It used to tween `width`, `backdrop-filter` and `box-shadow` with springs —
 * three properties that need layout + paint on every frame, and that Motion
 * had to read back from the DOM on mount (a forced reflow in every trace).
 * The `layoutId` hover pill was the single feature on the site that pulled
 * Motion's `domMax` bundle in instead of `domAnimation`.
 *
 * Everything is a CSS transition now (`.rn-*` in globals.css), switched by a
 * `data-visible` attribute from one passive scroll listener. Same look, and
 * the navbar costs nothing at hydration beyond attaching two handlers.
 */

interface NavbarProps {
  children: React.ReactNode;
  className?: string;
}

interface NavBodyProps {
  children: React.ReactNode;
  className?: string;
  visible?: boolean;
}

interface NavItemsProps {
  items: {
    name: string;
    link: string;
  }[];
  className?: string;
  onItemClick?: () => void;
}

interface MobileNavProps {
  children: React.ReactNode;
  className?: string;
  visible?: boolean;
}

interface MobileNavHeaderProps {
  children: React.ReactNode;
  className?: string;
}

interface MobileNavMenuProps {
  children: React.ReactNode;
  className?: string;
  isOpen: boolean;
  onClose: () => void;
  /** Anchor id for the panel. */
  id?: string;
}

const DOCK_AT = 100;

/** True once the page has scrolled past `DOCK_AT`. One passive listener,
    rAF-coalesced so a fast fling sets state once per frame, not per event. */
function useDocked(): boolean {
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      setDocked(window.scrollY > DOCK_AT);
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);
  return docked;
}

export const Navbar = ({ children, className }: NavbarProps) => {
  const visible = useDocked();

  return (
    <div className={cn('fixed inset-x-0 top-0 z-40 w-full', className)}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(
              child as React.ReactElement<{ visible?: boolean }>,
              { visible },
            )
          : child,
      )}
    </div>
  );
};

export const NavBody = ({ children, className, visible }: NavBodyProps) => {
  return (
    <div
      data-visible={visible ? 'true' : 'false'}
      style={{
        minWidth: 'min(800px, 100%)',
      }}
      className={cn(
        'rn-body relative z-[60] mx-auto hidden max-w-7xl flex-row items-center justify-between self-start bg-transparent px-4 py-2 lg:flex dark:bg-transparent',
        visible && 'bg-white/80 dark:bg-neutral-950/80',
        className,
      )}
    >
      {children}
    </div>
  );
};

export const NavItems = ({ items, className, onItemClick }: NavItemsProps) => {
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);

  // The pill is moved imperatively: a hover should not re-render the nav, and
  // a transform transition on one <span> is all the "shared layout" this needs.
  const moveTo = (el: HTMLElement) => {
    const pill = pillRef.current;
    if (!pill) return;
    // On its first showing the pill must snap to the link and only fade —
    // otherwise it glides in from the nav's corner, since the position vars
    // default to 0. The inline override is cleared once the snap has been
    // committed by the forced reflow.
    const first = !pill.classList.contains('on');
    if (first) pill.style.transition = 'opacity 0.18s ease';
    pill.style.setProperty('--pill-x', `${el.offsetLeft}px`);
    pill.style.setProperty('--pill-y', `${el.offsetTop}px`);
    pill.style.setProperty('--pill-w', `${el.offsetWidth}px`);
    pill.style.setProperty('--pill-h', `${el.offsetHeight}px`);
    pill.classList.add('on');
    if (first) {
      void pill.offsetWidth;
      pill.style.transition = '';
    }
  };
  const hide = () => pillRef.current?.classList.remove('on');

  return (
    // A landmark, not a div. `hidden lg:flex` takes it out of the a11y tree
    // below the breakpoint, so it never competes with the mobile menu's own nav.
    <nav
      ref={navRef}
      aria-label="Main"
      onMouseLeave={hide}
      className={cn(
        'absolute inset-0 hidden flex-1 flex-row items-center justify-center space-x-2 text-sm font-medium text-zinc-600 transition duration-200 hover:text-zinc-800 lg:flex lg:space-x-2',
        className,
      )}
    >
      <span ref={pillRef} className="rn-pill bg-gray-100 dark:bg-neutral-800" aria-hidden="true" />
      {items.map((item, idx) => (
        <a
          onMouseEnter={(e) => moveTo(e.currentTarget)}
          onFocus={(e) => moveTo(e.currentTarget)}
          onBlur={hide}
          onClick={onItemClick}
          className="relative px-4 py-2 text-neutral-600 dark:text-neutral-300"
          key={`link-${idx}`}
          href={item.link}
        >
          <span className="relative z-20">{item.name}</span>
        </a>
      ))}
    </nav>
  );
};

export const MobileNav = ({ children, className, visible }: MobileNavProps) => {
  return (
    <div
      data-visible={visible ? 'true' : 'false'}
      className={cn(
        'rn-mobile relative z-50 mx-auto flex max-w-[calc(100vw-2rem)] flex-col items-center justify-between bg-transparent px-4 py-2 lg:hidden',
        visible && 'bg-white/80 dark:bg-neutral-950/80',
        className,
      )}
    >
      {children}
    </div>
  );
};

export const MobileNavHeader = ({
  children,
  className,
}: MobileNavHeaderProps) => {
  return (
    <div
      className={cn(
        'flex w-full flex-row items-center justify-between',
        className,
      )}
    >
      {children}
    </div>
  );
};

export const MobileNavMenu = ({
  children,
  className,
  isOpen,
  id,
}: MobileNavMenuProps) => {
  if (!isOpen) return null;
  return (
    <nav
      id={id}
      aria-label="Site"
      className={cn(
        'rn-menu absolute right-4 top-16 z-50 flex min-w-[160px] flex-col items-start justify-start gap-4 rounded-lg bg-white px-4 py-8 shadow-[0_0_24px_rgba(34,_42,_53,_0.06),_0_1px_1px_rgba(0,_0,_0,_0.05),_0_0_0_1px_rgba(34,_42,_53,_0.04),_0_0_4px_rgba(34,_42,_53,_0.08),_0_16px_68px_rgba(47,_48,_55,_0.05),_0_1px_0_rgba(255,_255,_255,_0.1)_inset] dark:bg-neutral-950',
        className,
      )}
    >
      {children}
    </nav>
  );
};

/**
 * A real <button>, not an <svg> with an onClick. Below `lg` the desktop NavItems
 * row is hidden, so this control is the ONLY route to Skills/Experience/
 * Projects/Contact — as a bare icon it was skipped by Tab entirely and
 * announced as nothing, which put the whole navigation out of reach of a
 * keyboard or screen-reader visitor on a phone.
 */
export const MobileNavToggle = ({
  isOpen,
  onClick,
}: {
  isOpen: boolean;
  onClick: () => void;
}) => {
  const Icon = isOpen ? IconX : IconMenu2;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isOpen ? 'Close menu' : 'Open menu'}
      aria-expanded={isOpen}
      /* No aria-controls: the panel is only in the DOM while open, which is the
         one state the attribute would never be read in — a dangling IDREF every
         time it matters. aria-expanded plus DOM adjacency is the real
         association here. */
      className="relative z-20 -m-2 flex items-center justify-center p-2 text-black dark:text-white"
    >
      <Icon aria-hidden="true" />
    </button>
  );
};

export const NavbarLogo = ({ label }: { label: string }) => {
  return (
    <a
      href="#"
      className="relative z-20 mr-4 flex items-center space-x-2 px-2 py-1 text-sm font-bold text-black dark:text-white"
    >
      <span>{label}</span>
    </a>
  );
};
