'use client';

import React, { useEffect, useRef } from 'react';

/**
 * The full line field, drawn once as a single faint path. Fifty strokes, one
 * DOM node. This is the texture; the beams below are the light that runs
 * along it.
 */
const paths = [
  "M-380 -189C-380 -189 -312 216 152 343C616 470 684 875 684 875",
  "M-373 -197C-373 -197 -305 208 159 335C623 462 691 867 691 867",
  "M-366 -205C-366 -205 -298 200 166 327C630 454 698 859 698 859",
  "M-359 -213C-359 -213 -291 192 173 319C637 446 705 851 705 851",
  "M-352 -221C-352 -221 -284 184 180 311C644 438 712 843 712 843",
  "M-345 -229C-345 -229 -277 176 187 303C651 430 719 835 719 835",
  "M-338 -237C-338 -237 -270 168 194 295C658 422 726 827 726 827",
  "M-331 -245C-331 -245 -263 160 201 287C665 414 733 819 733 819",
  "M-324 -253C-324 -253 -256 152 208 279C672 406 740 811 740 811",
  "M-317 -261C-317 -261 -249 144 215 271C679 398 747 803 747 803",
  "M-310 -269C-310 -269 -242 136 222 263C686 390 754 795 754 795",
  "M-303 -277C-303 -277 -235 128 229 255C693 382 761 787 761 787",
  "M-296 -285C-296 -285 -228 120 236 247C700 374 768 779 768 779",
  "M-289 -293C-289 -293 -221 112 243 239C707 366 775 771 775 771",
  "M-282 -301C-282 -301 -214 104 250 231C714 358 782 763 782 763",
  "M-275 -309C-275 -309 -207 96 257 223C721 350 789 755 789 755",
  "M-268 -317C-268 -317 -200 88 264 215C728 342 796 747 796 747",
  "M-261 -325C-261 -325 -193 80 271 207C735 334 803 739 803 739",
  "M-254 -333C-254 -333 -186 72 278 199C742 326 810 731 810 731",
  "M-247 -341C-247 -341 -179 64 285 191C749 318 817 723 817 723",
  "M-240 -349C-240 -349 -172 56 292 183C756 310 824 715 824 715",
  "M-233 -357C-233 -357 -165 48 299 175C763 302 831 707 831 707",
  "M-226 -365C-226 -365 -158 40 306 167C770 294 838 699 838 699",
  "M-219 -373C-219 -373 -151 32 313 159C777 286 845 691 845 691",
  "M-212 -381C-212 -381 -144 24 320 151C784 278 852 683 852 683",
  "M-205 -389C-205 -389 -137 16 327 143C791 270 859 675 859 675",
  "M-198 -397C-198 -397 -130 8 334 135C798 262 866 667 866 667",
  "M-191 -405C-191 -405 -123 0 341 127C805 254 873 659 873 659",
  "M-184 -413C-184 -413 -116 -8 348 119C812 246 880 651 880 651",
  "M-177 -421C-177 -421 -109 -16 355 111C819 238 887 643 887 643",
  "M-170 -429C-170 -429 -102 -24 362 103C826 230 894 635 894 635",
  "M-163 -437C-163 -437 -95 -32 369 95C833 222 901 627 901 627",
  "M-156 -445C-156 -445 -88 -40 376 87C840 214 908 619 908 619",
  "M-149 -453C-149 -453 -81 -48 383 79C847 206 915 611 915 611",
  "M-142 -461C-142 -461 -74 -56 390 71C854 198 922 603 922 603",
  "M-135 -469C-135 -469 -67 -64 397 63C861 190 929 595 929 595",
  "M-128 -477C-128 -477 -60 -72 404 55C868 182 936 587 936 587",
  "M-121 -485C-121 -485 -53 -80 411 47C875 174 943 579 943 579",
  "M-114 -493C-114 -493 -46 -88 418 39C882 166 950 571 950 571",
  "M-107 -501C-107 -501 -39 -96 425 31C889 158 957 563 957 563",
  "M-100 -509C-100 -509 -32 -104 432 23C896 150 964 555 964 555",
  "M-93 -517C-93 -517 -25 -112 439 15C903 142 971 547 971 547",
  "M-86 -525C-86 -525 -18 -120 446 7C910 134 978 539 978 539",
  "M-79 -533C-79 -533 -11 -128 453 -1C917 126 985 531 985 531",
  "M-72 -541C-72 -541 -4 -136 460 -9C924 118 992 523 992 523",
  "M-65 -549C-65 -549 3 -144 467 -17C931 110 999 515 999 515",
  "M-58 -557C-58 -557 10 -152 474 -25C938 102 1006 507 1006 507",
  "M-51 -565C-51 -565 17 -160 481 -33C945 94 1013 499 1013 499",
  "M-44 -573C-44 -573 24 -168 488 -41C952 86 1020 491 1020 491",
  "M-37 -581C-37 -581 31 -176 495 -49C959 78 1027 483 1027 483",
];

const allPathsD = paths.join('');

/**
 * Which of the fifty lines carry a beam. Every ~3.5th line, so the sweep reads
 * as scattered rather than as a comb — 14 beams is what the old 50 looked like
 * once you subtract the ones that were mid-gap at any moment. Fewer strokes to
 * repaint per frame, and ~290 fewer DOM nodes than 50 beams each with its own
 * five-node gradient.
 *
 * Timing is fixed per beam rather than Math.random() at mount: the server and
 * client must agree on the markup, and a deterministic spread looks identical
 * to a random one.
 */
const BEAMS: { i: number; dur: number; delay: number }[] = [
  { i: 0, dur: 8.5, delay: 0 },
  { i: 4, dur: 10, delay: 1.1 },
  { i: 7, dur: 7.5, delay: 2.4 },
  { i: 11, dur: 9.5, delay: 0.6 },
  { i: 14, dur: 8, delay: 3.2 },
  { i: 18, dur: 11, delay: 1.7 },
  { i: 21, dur: 7, delay: 4.1 },
  { i: 25, dur: 9, delay: 0.3 },
  { i: 28, dur: 10.5, delay: 2.9 },
  { i: 32, dur: 8, delay: 1.4 },
  { i: 35, dur: 9.5, delay: 3.7 },
  { i: 39, dur: 7.5, delay: 0.9 },
  { i: 43, dur: 10, delay: 2.1 },
  { i: 47, dur: 8.5, delay: 3.5 },
];

export default React.memo(function BackgroundLines() {
  const wrapRef = useRef<HTMLDivElement>(null);

  // The beams sit paused (see .bg-beams in globals.css) until the browser has
  // nothing better to do. Flipping the attribute directly, rather than through
  // state, means this component never re-renders: the server markup IS the
  // final markup, hydration has nothing to reconcile, and the only work here is
  // one attribute write.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (window.matchMedia('(max-width: 1024px)').matches) return;

    const start = () => el.setAttribute('data-beams', 'on');
    // Safari has no requestIdleCallback; a plain timeout is the fallback there.
    const ric: typeof window.requestIdleCallback | undefined = window.requestIdleCallback;
    let idle: number | undefined;
    let timer: number | undefined;
    const schedule = () => {
      if (ric) idle = ric(start, { timeout: 2500 });
      else timer = window.setTimeout(start, 1500);
    };
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, { once: true });

    return () => {
      window.removeEventListener('load', schedule);
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return (
    <div ref={wrapRef} className="pointer-events-none fixed inset-0 z-0">
      {/* Two SVGs, not one. The line field below is painted once and never
          again; the beams are in their own SVG on their own compositor layer
          (.bg-beams-layer), so a sweep frame repaints fourteen half-pixel
          strokes and not the fifty underneath them as well. */}
      <svg
        className="absolute inset-0 h-full w-full"
        width="100%"
        height="100%"
        viewBox="0 0 696 316"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d={allPathsD}
          stroke="url(#bg-lines-radial)"
          strokeOpacity="0.05"
          strokeWidth="0.5"
        />
        <defs>
          <radialGradient
            id="bg-lines-radial"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="translate(352 34) rotate(90) scale(555 1560.62)"
          >
            <stop offset="0.0666667" stopColor="var(--foreground)" />
            <stop offset="0.243243" stopColor="var(--foreground)" />
            <stop offset="0.43594" stopColor="var(--foreground)" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>
      {/* Desktop only, and hidden under prefers-reduced-motion — both by CSS,
          which applies before first paint, so there is no flash for exactly
          the people who asked for none. */}
      <svg
        className="bg-beams-layer absolute inset-0 h-full w-full"
        width="100%"
        height="100%"
        viewBox="0 0 696 316"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <g className="bg-beams">
          {BEAMS.map(({ i, dur, delay }) => (
            <path
              key={i}
              d={paths[i]}
              pathLength={1}
              stroke="url(#bg-beam)"
              strokeOpacity="0.4"
              strokeWidth="0.5"
              style={{ '--beam-dur': `${dur}s`, '--beam-delay': `${delay}s` } as React.CSSProperties}
            />
          ))}
        </g>
        <defs>
          {/* One gradient for every beam, laid along the lines' direction of
              travel in user space, so a dash is cyan at its head and violet at
              its tail wherever it is on the path. */}
          <linearGradient
            id="bg-beam"
            gradientUnits="userSpaceOnUse"
            x1="-380"
            y1="-580"
            x2="1030"
            y2="880"
          >
            <stop offset="0" stopColor="#18CCFC" stopOpacity="0" />
            <stop offset="0.2" stopColor="#18CCFC" />
            <stop offset="0.55" stopColor="#6344F5" />
            <stop offset="1" stopColor="#AE48FF" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
});
