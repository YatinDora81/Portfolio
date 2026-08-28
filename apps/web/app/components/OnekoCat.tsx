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
