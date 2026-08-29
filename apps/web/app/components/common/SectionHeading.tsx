import type { ReactNode } from 'react';
import DecodeLabel from './DecodeLabel';

interface SectionHeadingProps {
  channel: string;
  label: string;
  title: string;
  hint?: ReactNode;
}

export default function SectionHeading({ channel, label, title, hint }: SectionHeadingProps) {
  return (
    <div>
      <div className="lab">
        <DecodeLabel text={`${label} — ch.${channel}`} />
        <i aria-hidden="true" />
        {hint != null && hint !== '' && <span className="hint mono">{hint}</span>}
      </div>
      <h2 className="sec-title">{title}</h2>
    </div>
  );
}
