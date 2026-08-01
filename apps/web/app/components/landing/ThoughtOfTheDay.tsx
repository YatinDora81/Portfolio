import type { CSSProperties } from 'react';
import Container from '../common/Container';
import ThoughtEntry from './ThoughtEntry';

interface Quote {
  quote: string;
  author: string;
}

interface ThoughtProps {
  /** The day's pick, chosen server-side — the only quote this section ever shows. */
  quote: Quote | null;
  /** That same day, formatted server-side (e.g. "aug 1") to keep them in step. */
  date: string;
  /** The same day again as YYYY-MM-DD. Optional: without it the label renders as
      plain text rather than as a <time> whose body no parser can read. */
  iso?: string;
  /** Day of the year, 1-based, and how many the year has — the ledger index in
      the keyline. Both come from page.tsx off the same UTC midnight as `date`. */
  day: number;
  days: number;
}

/** Copyfit, decided here rather than after paint — the length is known at render,
    and a client-side measure-then-resize would be pure layout shift on a section
    nobody has scrolled to yet. Past 90 characters the block has stopped being an
    aphorism and takes the reading rung. This number and the two `ch` caps in the
    stylesheet are the whole tuning surface. */
function rung(len: number): 'short' | 'long' {
  return len > 90 ? 'long' : 'short';
}

export default function ThoughtOfTheDay({ quote, date, iso, day, days }: ThoughtProps) {
  // A CMS row can exist with a blank body, which `!quote` alone never caught —
  // it rendered an empty blockquote and a dash pointing at nothing.
  const body = quote?.quote.trim() ?? '';
  const author = quote?.author.trim() ?? '';
  if (!body) return null;

  // Split here, not in ThoughtEntry: the whole point of the server/client seam
  // is that the day's quote never enters the client bundle. ThoughtEntry reads
  // these spans back out of the DOM.
  const words = body.split(' ');

  return (
    <section className="thought">
      <Container className="mt-20 animate-fade-in-blur animate-delay-5">
        {/* The visible key is a mono label, so without this a heading scan goes
            Blogs → Contact and the quote is orphaned text between two landmarks. */}
        <h2 className="sr-only">Thought of the day</h2>

        <ThoughtEntry len={rung(body.length)}>
          {/* `.lab` with nothing overridden — the page's own keyline unit, with
              the day index and date hung off it as hints: lowercase, lighter,
              untracked. */}
          <div className="lab">
            <span>thought of the day</span>
            <i aria-hidden="true" />
            <span className="hint mono">
              day {day} / {days}
            </span>
            {iso ? (
              <time className="hint mono" dateTime={iso}>
                {date}
              </time>
            ) : (
              <span className="hint mono">{date}</span>
            )}
          </div>

          <blockquote className="th-quote">
            <p>
              {words.map((w, i) => (
                // The trailing space belongs INSIDE the span — `white-space: pre`
                // keeps it, and putting it between the spans instead lets the
                // inline-blocks collapse it and fuse every word to the next.
                <span
                  key={i}
                  className="w"
                  style={{ '--d': `${(i * 0.045).toFixed(3)}s` } as CSSProperties}
                >
                  {i < words.length - 1 ? `${w} ` : w}
                </span>
              ))}
            </p>
          </blockquote>

          <p className="th-hintline mono" aria-hidden="true">
            ⌖ move your cursor through the words
          </p>

          {/* The attribution sits OUTSIDE the blockquote, which is what the HTML
              spec asks for and what reads cleanly in NVDA and JAWS. NOT <cite>:
              that element is for the title of a work, and this model holds a
              bare person's name with no source URL for a cite="" either. */}
          {author && (
            <footer className="th-foot">
              <i aria-hidden="true" />
              <span className="th-author">— {author}</span>
            </footer>
          )}
        </ThoughtEntry>
      </Container>
    </section>
  );
}
