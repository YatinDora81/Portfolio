import type { Metadata } from "next";
import { loadVault } from "@/lib/notes/vault";
import { indexVault } from "@/lib/notes/vault-view";
import { NOTES_ROOT, notePathOf } from "@/lib/notes/view-types";
import { NotePane } from "../components/note-pane";

export default function NotePage() {
  return <NotePane />;
}

// streamed route metadata overwrites the title NotePane sets
export async function generateMetadata({
  params,
}: {
  params: Promise<{ segments?: string[] }>;
}): Promise<Metadata> {
  const { segments } = await params;
  const path = notePathOf([NOTES_ROOT, ...(segments ?? [])].join("/"));
  if (!path) return { title: "Notes" };
  const ix = indexVault(await loadVault());
  return { title: `${ix.byPath.get(path)?.title ?? "Not in the vault"} · Notes` };
}
