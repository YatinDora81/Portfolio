'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';
import type { CatNapStyle } from '../lib/data';

export default function OnekoCat({
  napStyle = 'ticks',
  napSeconds = 30,
}: {
  napStyle?: CatNapStyle;
  napSeconds?: number;
}) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsDesktop(window.innerWidth > 1024);
  }, []);

  if (!isDesktop) return null;
  // `lazyOnload` + the minified build keep the cat out of the load-time trace:
  // it now boots during browser idle after `load` instead of competing with
  // hydration (helps TBT / "minify JavaScript" / long-task audits). The
  // un-minified source stays in public/oneko/oneko.js for hacking on.
  return (
    <Script
      src="/oneko/oneko.min.js"
      strategy="lazyOnload"
      data-cat="/oneko/oneko.gif"
      data-nap-style={napStyle}
      data-nap-seconds={String(napSeconds)}
    />
  );
}
