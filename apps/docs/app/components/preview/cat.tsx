"use client";

import { CatSprite, NapStage, NAP_STAGE_CSS, DRAWN_STYLES } from "@/components/cat/nap-stage";
import { DIM, FAINT, MONO } from "./frame";

const NAP_F = 0.62;

const SITE_STAGE: React.CSSProperties = {
  ["--nsp-ink" as string]: "#34d399",
  ["--nsp-stage" as string]: "#0a0a0a",
  ["--nsp-track" as string]: "rgba(255,255,255,.16)",
  ["--nsp-face" as string]: "#e5e5eb",
  ["--nsp-panel" as string]: "#18181b",
  ["--nsp-edge" as string]: "#52525b",
  ["--nsp-off" as string]: "#3f3f46",
  ["--nsp-meta" as string]: "#a3a3a3",
};

const WIRE = "rgba(255,255,255,0.1)";

function Paw({ o, tilt, dx }: { o: number; tilt: number; dx: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ width: 13, height: 13, display: "block", opacity: o, transform: `translateX(${dx}px) rotate(${tilt}deg)` }}
    >
      <ellipse cx="5.6" cy="12.3" rx="1.9" ry="2.5" />
      <ellipse cx="9.7" cy="7.8" rx="2" ry="2.7" />
      <ellipse cx="14.3" cy="7.8" rx="2" ry="2.7" />
      <ellipse cx="18.4" cy="12.3" rx="1.9" ry="2.5" />
      <path d="M12 12.4c-3.1 0-5.6 2.1-5.6 4.8 0 2 1.7 3.4 3.9 3.4 1 0 1.2-.4 1.7-.4s.7.4 1.7.4c2.2 0 3.9-1.4 3.9-3.4 0-2.7-2.5-4.8-5.5-4.8Z" />
    </svg>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: ".08em", color: FAINT }}>{children}</p>
  );
}

export function CatPreview({
  napStyle,
  napSeconds,
  catOn = true,
}: {
  napStyle: string;
  napSeconds: number;
  catOn?: boolean;
}) {
  const secs = `${Math.max(1, Math.ceil(NAP_F * napSeconds))}s`;
  const sleeping = napStyle !== "off";
  const drawnStyle = napStyle === "random" ? DRAWN_STYLES[0] : napStyle;

  return (
    <div className="nsp" style={SITE_STAGE}>
      <style>{NAP_STAGE_CSS}</style>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, color: DIM, paddingBottom: 20 }}>
        <Paw o={0.3} tilt={-14} dx={-6} />
        <Paw o={0.55} tilt={12} dx={6} />
        <Paw o={0.85} tilt={-8} dx={-4} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "1rem", color: DIM }}>
        <span style={{ flex: 1, borderTop: `1px solid ${WIRE}` }} />
        <span
          style={{
            fontFamily: MONO, fontSize: 13, letterSpacing: ".05em", lineHeight: 1,
            transform: "translateY(-1px)", color: catOn ? DIM : FAINT,
          }}
        >
          {catOn ? "=^..^=" : "·"}
        </span>
        <span style={{ flex: 1, borderTop: `1px solid ${WIRE}` }} />
      </div>

      <div style={{ marginTop: 10, textAlign: "center" }}>
        <Note>hero ↑ · about ↓ — the paw in the navbar takes the cat off this wire</Note>
      </div>

      <div style={{ marginTop: 26, borderTop: `1px solid ${WIRE}`, paddingTop: 18 }}>
        <Note>{sleeping ? `dropped within 64px of a window edge · sleeps ${napSeconds}s` : "napping is off · the cat never sleeps"}</Note>

        <div
          style={{
            position: "relative", marginTop: 10, height: 188, borderRadius: 10,
            border: `1px dashed ${WIRE}`, background: "#0a0a0a", overflow: "hidden",
          }}
        >
          <span style={{ position: "absolute", left: 0, right: 0, bottom: 44, borderTop: `1px dashed rgba(52,211,153,.28)` }} />
          <span style={{ position: "absolute", top: 0, bottom: 0, right: 124, borderLeft: `1px dashed rgba(52,211,153,.28)` }} />
          <span
            style={{
              position: "absolute", right: 8, bottom: 48, fontFamily: MONO, fontSize: 9,
              letterSpacing: ".1em", color: "rgba(52,211,153,.75)",
            }}
          >
            nap zone
          </span>

          <div style={{ position: "absolute", right: 64, bottom: 6 }}>
            {sleeping ? (
              <NapStage bare style={drawnStyle} f={NAP_F} secs={secs} catFrame={0} />
            ) : (
              <div className="nsp-stage nsp-stage-bare">
                <CatSprite frame={0} asleep={false} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
