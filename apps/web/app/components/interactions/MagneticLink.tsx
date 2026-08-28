'use client';

import { useRef, type AnchorHTMLAttributes } from 'react';
import { useMagnetic } from '../../hooks/useMagnetic';

export default function MagneticLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const ref = useRef<HTMLAnchorElement>(null);
  useMagnetic(ref);
  return <a ref={ref} {...props} />;
}
