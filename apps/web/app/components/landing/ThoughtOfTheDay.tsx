'use client';

import { useState, useEffect } from 'react';
import Container from '../common/Container';

interface Quote {
  quote: string;
  author: string;
}

function getToday() {
  const now = new Date();
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

export default function ThoughtOfTheDay({ quotes }: { quotes: Quote[] }) {
  const [thought, setThought] = useState(quotes[0]);

  useEffect(() => {
    if (quotes.length > 0) {
      const index = getToday() % quotes.length;
      setThought(quotes[index]!);
    }
  }, [quotes]);

  if (!thought) return null;

  return (
    <Container className="mt-20 animate-fade-in-blur animate-delay-6">
      <div className="relative rounded-xl border border-border bg-card p-5 sm:p-8 text-center">
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-background px-3 text-xs font-medium text-secondary uppercase tracking-wider">
          Thought of the Day
        </span>
        <blockquote className="text-base sm:text-lg font-medium leading-relaxed italic text-foreground/90">
          &ldquo;{thought.quote}&rdquo;
        </blockquote>
        <p className="mt-3 text-sm text-secondary">
          — {thought.author}
        </p>
      </div>
    </Container>
  );
}
