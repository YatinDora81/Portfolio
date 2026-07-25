import Container from '../common/Container';

interface Quote {
  quote: string;
  author: string;
}

// Server component: the day's quote is picked server-side in page.tsx and passed
// in, so only one quote ships in the payload and there's no post-hydration swap.
export default function ThoughtOfTheDay({ quote }: { quote: Quote | null }) {
  if (!quote) return null;

  // Deliberately no `cv-auto`: the card is ~130px, but content-visibility reserves
  // the 600px intrinsic size until it scrolls in, so the placeholder collapsed and
  // yanked everything below it upward. Skipping also applies paint containment,
  // which clipped the badge where it straddles the card's top border.
  return (
    <Container className="mt-20 animate-fade-in-blur animate-delay-6">
      <div className="relative rounded-xl border border-border bg-card p-5 sm:p-8 text-center">
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-background px-3 text-xs font-medium text-secondary uppercase tracking-wider">
          Thought of the Day
        </span>
        <blockquote className="text-base sm:text-lg font-medium leading-relaxed italic text-foreground/90">
          &ldquo;{quote.quote}&rdquo;
        </blockquote>
        <p className="mt-3 text-sm text-secondary">
          — {quote.author}
        </p>
      </div>
    </Container>
  );
}
