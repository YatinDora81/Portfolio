"use client";

import { useEffect, useRef, useState } from "react";

const SPRITE_SIZE = 32;
const SPEED = 10;
const IDLE_TIME = 1000;

// Sprite sheet positions [row, col] for each animation frame
const SPRITES: Record<string, [number, number][]> = {
  idle: [[3, 3]],
  alert: [[3, 5]],
  scratch: [[0, 5], [1, 5]],
  yawn: [[3, 1], [3, 2]],
  sleep: [[2, 0], [2, 1]],
  runN: [[1, 2], [1, 3]],
  runNE: [[0, 0], [0, 1]],
  runE: [[0, 2], [0, 3]],
  runSE: [[1, 0], [1, 1]],
  runS: [[2, 6], [2, 7]],
  runSW: [[3, 0], [2, 5]],
  runW: [[2, 4], [2, 3]],
  runNW: [[2, 2], [3, 7]],
};

export default function NekoCat() {
  const catRef = useRef<HTMLDivElement>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    // Disable on mobile/tablet (<=1024px)
    if (window.innerWidth <= 1024) return;
    setIsDesktop(true);

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let mouseX = x;
    let mouseY = y;
    let frame = 0;
    let frameCount = 0;
    let idleCounter = 0;
    let idleState = "idle";
    let animationId: number;

    function setSprite(name: string, f: number) {
      const frames = SPRITES[name];
      if (!frames || !catRef.current) return;
      const [row, col] = frames[f % frames.length]!;
      catRef.current.style.backgroundPosition = `-${col * SPRITE_SIZE}px -${row * SPRITE_SIZE}px`;
    }

    function onMouseMove(e: MouseEvent) {
      mouseX = e.clientX;
      mouseY = e.clientY;
    }

    function tick() {
      const dx = mouseX - x;
      const dy = mouseY - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < SPEED * 2) {
        idleCounter++;
        if (idleCounter > IDLE_TIME / 16) {
          if (idleCounter > (IDLE_TIME * 4) / 16) {
            idleState = "sleep";
          } else if (idleCounter > (IDLE_TIME * 2) / 16) {
            idleState = "yawn";
          } else {
            idleState = "idle";
          }
          frameCount++;
          setSprite(idleState, Math.floor(frameCount / 8));
        } else {
          setSprite("idle", 0);
        }
      } else {
        idleCounter = 0;
        idleState = "idle";

        const angle = Math.atan2(dy, dx);
        x += Math.cos(angle) * SPEED;
        y += Math.sin(angle) * SPEED;

        let direction: string;
        const deg = ((angle * 180) / Math.PI + 360) % 360;
        if (deg >= 337.5 || deg < 22.5) direction = "runE";
        else if (deg < 67.5) direction = "runSE";
        else if (deg < 112.5) direction = "runS";
        else if (deg < 157.5) direction = "runSW";
        else if (deg < 202.5) direction = "runW";
        else if (deg < 247.5) direction = "runNW";
        else if (deg < 292.5) direction = "runN";
        else direction = "runNE";

        frame++;
        setSprite(direction, Math.floor(frame / 4));
      }

      if (catRef.current) {
        catRef.current.style.left = `${x - SPRITE_SIZE / 2}px`;
        catRef.current.style.top = `${y - SPRITE_SIZE / 2}px`;
      }

      animationId = requestAnimationFrame(tick);
    }

    window.addEventListener("mousemove", onMouseMove);
    animationId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      cancelAnimationFrame(animationId);
    };
  }, []);

  if (!isDesktop) return null;

  return (
    <div
      ref={catRef}
      className="fixed z-[9999] pointer-events-none"
      style={{
        width: SPRITE_SIZE,
        height: SPRITE_SIZE,
        backgroundImage: "url(https://raw.githubusercontent.com/adryd325/oneko.js/14bab15a755d0e35cd4ae19c931b96f8f2e24c99/oneko.gif)",
        imageRendering: "pixelated",
      }}
    />
  );
}
