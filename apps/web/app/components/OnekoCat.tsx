'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';

export default function OnekoCat() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsDesktop(window.innerWidth > 1024);
  }, []);

  if (!isDesktop) return null;
  return <Script src="/oneko/oneko.js" data-cat="/oneko/oneko.gif" />;
}
