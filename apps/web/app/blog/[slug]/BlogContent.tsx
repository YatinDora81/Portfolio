'use client';

export default function BlogContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Empty line
    if (!trimmed) {
      i++;
      continue;
    }

    // Skip h1 (title already shown)
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      i++;
      continue;
    }

    // Code block
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre
          key={elements.length}
          className="my-4 overflow-x-auto rounded-lg border border-border bg-card p-4 text-[13px] leading-relaxed"
        >
          {lang && (
            <div className="mb-2 text-[11px] uppercase tracking-wider text-secondary">{lang}</div>
          )}
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h4 key={elements.length} className="mt-6 mb-2 text-base font-semibold text-foreground">
          {trimmed.slice(4)}
        </h4>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(
        <h3 key={elements.length} className="mt-8 mb-3 text-lg font-semibold text-foreground">
          {trimmed.slice(3)}
        </h3>
      );
      i++;
      continue;
    }

    // Unordered list - collect consecutive items
    if (trimmed.startsWith('- ')) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('- ')) {
        items.push(
          <li key={items.length} className="ml-1 text-secondary leading-relaxed">
            <InlineMarkdown text={lines[i]!.trim().slice(2)} />
          </li>
        );
        i++;
      }
      elements.push(
        <ul key={elements.length} className="my-3 ml-4 list-disc space-y-1.5">
          {items}
        </ul>
      );
      continue;
    }

    // Ordered list - collect consecutive items
    if (/^\d+\. /.test(trimmed)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i]!.trim())) {
        items.push(
          <li key={items.length} className="ml-1 text-secondary leading-relaxed">
            <InlineMarkdown text={lines[i]!.trim().replace(/^\d+\.\s/, '')} />
          </li>
        );
        i++;
      }
      elements.push(
        <ol key={elements.length} className="my-3 ml-4 list-decimal space-y-1.5">
          {items}
        </ol>
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={elements.length} className="my-3 text-secondary leading-relaxed">
        <InlineMarkdown text={trimmed} />
      </p>
    );
    i++;
  }

  return <div className="text-sm sm:text-base">{elements}</div>;
}

function InlineMarkdown({ text }: { text: string }) {
  // Handle bold, inline code, and links
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.*?)\*\*|`(.*?)`|\[(.*?)\]\((.*?)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2] !== undefined) {
      // Bold
      parts.push(<strong key={parts.length} className="font-semibold text-foreground">{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      // Inline code
      parts.push(
        <code key={parts.length} className="rounded bg-card border border-border px-1.5 py-0.5 text-[0.85em] font-mono">
          {match[3]}
        </code>
      );
    } else if (match[4] !== undefined && match[5] !== undefined) {
      // Link
      parts.push(
        <a key={parts.length} href={match[5]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground transition-colors">
          {match[4]}
        </a>
      );
    }
    lastIndex = match.index + match[0]!.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}
