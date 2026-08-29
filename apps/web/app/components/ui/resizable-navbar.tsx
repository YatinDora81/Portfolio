'use client';

import { cn } from '@/lib/utils';
import { IconMenu2, IconX } from '@tabler/icons-react';
import React, { useEffect, useRef, useState } from 'react';

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
  id?: string;
}

const DOCK_AT = 100;

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
        'rn-body relative z-[60] mx-auto hidden max-w-7xl flex-row items-center justify-between self-start bg-transparent px-4 py-2 lg:flex',
        visible && 'bg-background/80',
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

  const moveTo = (el: HTMLElement) => {
    const pill = pillRef.current;
    if (!pill) return;
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
    <nav
      ref={navRef}
      aria-label="Main"
      onMouseLeave={hide}
      className={cn(
        'absolute inset-0 hidden flex-1 flex-row items-center justify-center space-x-2 text-sm font-medium text-secondary-ink transition duration-200 hover:text-foreground lg:flex lg:space-x-2',
        className,
      )}
    >
      <span ref={pillRef} className="rn-pill bg-muted" aria-hidden="true" />
      {items.map((item, idx) => (
        <a
          onMouseEnter={(e) => moveTo(e.currentTarget)}
          onFocus={(e) => moveTo(e.currentTarget)}
          onBlur={hide}
          onClick={onItemClick}
          className="relative px-4 py-2 text-secondary-ink"
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
        visible && 'bg-background/80',
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
        'rn-menu absolute right-4 top-16 z-50 flex min-w-[160px] flex-col items-start justify-start gap-4 rounded-lg bg-background px-4 py-8 shadow-[0_0_24px_rgba(34,_42,_53,_0.06),_0_1px_1px_rgba(0,_0,_0,_0.05),_0_0_0_1px_rgba(34,_42,_53,_0.04),_0_0_4px_rgba(34,_42,_53,_0.08),_0_16px_68px_rgba(47,_48,_55,_0.05),_0_1px_0_rgba(255,_255,_255,_0.1)_inset]',
        className,
      )}
    >
      {children}
    </nav>
  );
};

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
