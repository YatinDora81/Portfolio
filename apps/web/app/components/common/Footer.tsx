import Container from './Container';
import { socialIconMap } from '@/lib/icon-map';

interface SocialLink {
  name: string;
  href: string;
  iconKey: string;
  detail: string | null;
}

export default function Footer({ socialLinks, copyrightName }: { socialLinks: SocialLink[]; copyrightName: string }) {
  return (
    <footer className="border-t border-border mt-20 py-10">
      <Container>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-center gap-x-4 sm:gap-x-6 gap-y-3">
            {socialLinks.map((link) => {
              const IconFn = socialIconMap[link.iconKey];
              return (
                <a
                  key={link.name}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-secondary hover:text-foreground transition-colors duration-200"
                >
                  {IconFn && IconFn({ className: 'size-4' })}
                  <span>{link.iconKey === 'email' ? link.detail : link.name}</span>
                </a>
              );
            })}
          </div>
          <p className="text-center text-secondary text-xs">
            &copy; {new Date().getFullYear()} {copyrightName}. All rights reserved.
          </p>
        </div>
      </Container>
    </footer>
  );
}
