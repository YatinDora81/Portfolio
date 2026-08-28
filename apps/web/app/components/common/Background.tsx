'use client';

import dynamic from 'next/dynamic';
import BackgroundLines from './BackgroundLines';
import { useBackground } from './BackgroundProvider';

const BackgroundTerrain = dynamic(() => import('./BackgroundTerrain'));

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
