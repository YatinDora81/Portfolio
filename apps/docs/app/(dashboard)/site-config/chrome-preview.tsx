"use client";

import { DIM, FAINT, MONO } from "@/components/preview/frame";

// ─── Chrome Preview ──────────────────────────────────────────────
// The two strips this page owns, at preview scale: the floating navbar at the
// top of every page and the footer that closes it. Deliberately not a Staged*
// wrapper — no staged entity writes either surface, so a pending-change chip
// here would permanently read zero while the form above is dirty.
//
// Mirrors apps/web/app/components/common/Navbar.tsx and Footer.tsx: the five
// section links (Blogs only when a post is published), the paw and theme
// toggles, the breathing ✦ divider, the mono copyright line, and the giant
// name mark that the footer bleeds off the bottom of the page.

const NAV_ITEMS = ["Skills", "Experience", "Projects", "Blogs", "Contact"];

function Unset({ children }: { children: string }) {
  return <em style={{ color: FAINT, fontWeight: 400, fontStyle: "italic" }}>{children}</em>;
}

export function ChromePreview({ logo, copyrightName, hasBlogs }: {
  logo: string;
  copyrightName: string;
  hasBlogs: boolean;
}) {
  const items = hasBlogs ? NAV_ITEMS : NAV_ITEMS.filter(i => i !== "Blogs");

  // `(wordmark || copyrightName || 'PORTFOLIO').toUpperCase()` — Footer.tsx.
  const mark = (copyrightName.trim() || "PORTFOLIO").toUpperCase();
  const year = new Date().getFullYear();

  return (
    <div>
      <p className="text-[10px]" style={{ color: DIM, marginBottom: 8 }}>
        Every page, above the fold
      </p>

      <div className="chr-strip chr-nav">
        <span className="chr-word">
          {logo.trim() || <Unset>no wordmark</Unset>}
        </span>
        <span className="chr-links" style={{ color: DIM }}>
          {items.map(i => <span key={i}>{i}</span>)}
        </span>
        <span className="chr-toggles" style={{ color: DIM }}>
          <span title="Paw toggle — shows or shoos the cat">&#128062;</span>
          <span title="Theme toggle">&#9789;</span>
        </span>
      </div>

      {!hasBlogs && (
        <p className="mt-2 text-[9px]" style={{ fontFamily: MONO, color: FAINT }}>
          no published posts — the Blogs link is dropped
        </p>
      )}

      <p className="text-[10px]" style={{ color: DIM, margin: "22px 0 8px" }}>
        Every page, at the very bottom
      </p>

      <div className="chr-strip" style={{ paddingBottom: 0, overflow: "hidden" }}>
        <div
          aria-hidden="true"
          className="flex items-center gap-2 text-[9px]"
          style={{ color: DIM }}
        >
          <span className="h-px flex-1" style={{ background: "rgba(255,255,255,.1)" }} />
          <span>&#10022;</span>
          <span className="h-px flex-1" style={{ background: "rgba(255,255,255,.1)" }} />
        </div>

        <p
          className="mt-4 text-center text-[9px] uppercase"
          style={{ fontFamily: MONO, letterSpacing: "0.2em", color: DIM }}
        >
          &copy; {year} {copyrightName.trim() || <Unset>no name</Unset>} &mdash; all rights reserved
        </p>

        {/* The name mark — bled off the bottom edge, as on the site. */}
        <div
          aria-hidden="true"
          className="mt-4 text-center font-extrabold leading-none"
          style={{
            fontSize: "clamp(28px, 12vw, 74px)",
            letterSpacing: "-.04em",
            color: "rgba(250,250,250,.13)",
            marginBottom: -14,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "clip",
          }}
        >
          {mark}
        </div>
      </div>

      <p className="mt-3 text-[9px]" style={{ fontFamily: MONO, color: FAINT }}>
        the mark reveals under the cursor on the real page · first word only below lg
      </p>
    </div>
  );
}
