import "server-only";
import { cache } from "react";
import { prisma } from "db";
import { KEYS } from "@/lib/site-config-keys";

export interface ReferenceSource {
  label: string;
  text: string;
}

export interface BlockedKey {
  key: string;
  usedIn: string[];
}

const MEMO_LIFETIME_MS = 10_000;

let memo: { at: number; sources: ReferenceSource[] } | null = null;

async function readSources(): Promise<ReferenceSource[]> {
  const [projects, blogs, experiences, config] = await Promise.all([
    prisma.project.findMany({ select: { title: true, logoUrl: true, images: true } }),
    prisma.blog.findMany({ select: { title: true, image: true, content: true } }),
    prisma.experience.findMany({ select: { company: true, logoUrl: true } }),
    prisma.siteConfig.findMany({ select: { key: true, value: true } }),
  ]);

  return [
    ...projects.map((p) => ({
      label: `Project · ${p.title}`,
      text: [p.logoUrl ?? "", ...p.images].join("\n"),
    })),
    ...blogs.map((b) => ({ label: `Blog · ${b.title}`, text: `${b.image}\n${b.content}` })),
    ...experiences.map((e) => ({ label: `Experience · ${e.company}`, text: e.logoUrl ?? "" })),
    ...config.map((c) => ({
      label: `Site setting · ${KEYS[c.key]?.label ?? c.key}`,
      text: c.value,
    })),
  ].filter((s) => s.text.trim() !== "");
}

async function readWithMemo(): Promise<ReferenceSource[]> {
  if (memo && Date.now() - memo.at < MEMO_LIFETIME_MS) return memo.sources;
  const sources = await readSources();
  memo = { at: Date.now(), sources };
  return sources;
}

const readOncePerRequest = cache(readWithMemo);

export async function referenceSources(fresh = false): Promise<ReferenceSource[]> {
  if (!fresh) return readOncePerRequest();
  const sources = await readSources();
  memo = { at: Date.now(), sources };
  return sources;
}

export function usersOf(sources: ReferenceSource[], key: string): string[] {
  if (key === "" || key.endsWith("/")) return [];
  return sources.filter((s) => s.text.includes(key)).map((s) => s.label);
}

export function usersOfMany(
  sources: ReferenceSource[],
  keys: readonly string[],
): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const key of keys) {
    if (found.has(key)) continue;
    found.set(key, usersOf(sources, key));
  }
  return found;
}

export function blockedBy(sources: ReferenceSource[], keys: readonly string[]): BlockedKey[] {
  const blocked: BlockedKey[] = [];
  for (const [key, usedIn] of usersOfMany(sources, keys)) {
    if (usedIn.length > 0) blocked.push({ key, usedIn });
  }
  return blocked;
}
