"use client";

// This module is a client module on purpose: `PreviewFrame` owns the
// device-width toggle and `HeroPreview` rotates its titles on a timer. Server
// pages keep importing both directly — they just render as client components.

// Barrel only. Each preview lives in its own file so the sections can be worked
// on independently; `@/components/preview` stays the one import path for all of
// them. Shared helpers (`SectionLabel`, `renderBold`, `parseBullet`, `FADE_MS`,
// `useRotatingTitle`) are NOT re-exported here — sections import them from
// `./frame` directly, so nothing inside the folder depends on this barrel.

export { PreviewFrame } from "./frame";
export { HeroPreview } from "./hero";
export { AboutPreview } from "./about";
export { SkillsPreview } from "./skills";
export { ExperiencePreview } from "./experience";
export { ProjectsPreview } from "./projects";
export { BlogsPreview } from "./blogs";
export { QuotesPreview } from "./quotes";
export { ContactPreview } from "./contact";
export { LinksPreview } from "./links";
export { CatPreview } from "./cat";
