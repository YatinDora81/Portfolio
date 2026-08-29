import type { CSSProperties } from 'react';
import Container from '../common/Container';
import ThoughtEntry from './ThoughtEntry';

interface Quote {
  quote: string;
  author: string;
}

interface ThoughtProps {
  quote: Quote | null;
  date: string;
  iso?: string;
  day: number;
  days: number;
}

function rung(len: number): 'short' | 'long' {
  return len > 90 ? 'long' : 'short';
}

export default function ThoughtOfTheDay({ quote, date, iso, day, days }: ThoughtProps) {
  const body = quote?.quote.trim() ?? '';
  const author = quote?.author.trim() ?? '';
  if (!body) return null;

  const words = body.split(' ');
  const progress = days > 0 ? Math.min(100, Math.max(0, (day / days) * 100)) : 0;

  return (
    <section className="thought">
      <Container className="animate-fade-in-blur animate-delay-5">
        <h2 className="sr-only">Thought of the day</h2>

        <ThoughtEntry len={rung(body.length)}>
          <div className="lab">
            <span>thought of the day</span>
            <i aria-hidden="true" />
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

          {author && (
            <footer className="th-foot">
              <i aria-hidden="true" />
              <span className="th-author">— {author}</span>
            </footer>
          )}

          <div className="th-year mono" role="img" aria-label={`Day ${day} of ${days}`}>
            <span>jan 01</span>
            <i style={{ '--x': `${progress.toFixed(2)}%` } as CSSProperties}>
              <b data-l={`day ${day}`} />
            </i>
            <span>dec 31</span>
          </div>
        </ThoughtEntry>
      </Container>
    </section>
  );
}
