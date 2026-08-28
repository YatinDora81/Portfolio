'use client';

import dynamic from 'next/dynamic';
import BackgroundLines from './BackgroundLines';
import { useBackground } from './BackgroundProvider';

/**
 * Which of the two runs is a database row, so no bundler can drop the branch
 * that does not: a static import ships the whole canvas engine — ~4KB gzipped,
 * plus the 256-step permutation shuffle it runs at module scope — in the first
 * load of every visitor, for code the default v1 never reaches. Behind
 * `import()` the chunk is not requested until something renders it.
 *
 * SSR stays on, which is the default. The veil is half of what this layer is,
 * and `ssr: false` would buy those 4KB back with a flash of unveiled ground on
 * every v2 page.
 */
const BackgroundTerrain = dynamic(() => import('./BackgroundTerrain'));

/**
 * The whole layer under the page: the field, and the veil that holds it back.
 * Both, because the veil is one of the terrain's controls — leaving the v1 div
 * at the call sites would stack a fixed half over a tuned one, and `error.tsx`
 * cannot read the database to know which of the two it should be drawing.
 *
 * So this replaces both lines every page carried, and v1's pair is reproduced
 * here exactly: an untouched database renders what the site rendered yesterday.
 */
export default function Background() {
  const bg = useBackground();

  if (bg.version === 'v2') {
    return (
      <BackgroundTerrain
        strength={bg.strength}
        veil={bg.veil}
        cell={bg.cell}
        levels={bg.levels}
        minor={bg.minor}
        major={bg.major}
        channel={bg.channel}
        interactive={bg.interactive}
      />
    );
  }

  return (
    <>
      <BackgroundLines />
      <div className="pointer-events-none fixed inset-0 z-[1] bg-background/50" />
    </>
  );
}
