'use client';

import { useRef, type AnchorHTMLAttributes } from 'react';
import { useMagnetic } from '../../hooks/useMagnetic';

/**
 * A plain anchor that leans toward the pointer. It renders exactly what it is
 * handed — the pull is the only thing it adds — so a hero CTA becomes magnetic
 * by changing its tag and nothing else.
 */
export default function MagneticLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const ref = useRef<HTMLAnchorElement>(null);
  useMagnetic(ref);
  return <a ref={ref} {...props} />;
}
