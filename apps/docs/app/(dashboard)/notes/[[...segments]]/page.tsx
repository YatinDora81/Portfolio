import type { Metadata } from "next";
import { loadVault } from "@/lib/notes/vault";
import { indexVault } from "@/lib/notes/vault-view";
import { NOTES_ROOT, notePathOf } from "@/lib/notes/view-types";
import { NotePane } from "../components/note-pane";

/**
 * The reader, and deliberately nothing else.
 *
 * Every note under /notes is drawn from the payload the layout already loaded,
 * so this segment has no data of its own and its output does not depend on the
 * URL that asked for it. That is the whole point: the tree moves between notes
 * with `history.pushState` and this never re-renders on the server at all.
 * `<NotePane>` reads the address bar instead.
 *
 * `force-dynamic` came off with the queries. It bought nothing once there were
 * none — the dashboard layout above reads cookies, so the route renders per
 * request regardless — and it cost the router cache on the real navigations
 * that are left, the ones back from Trash and Search.
 */
export default function NotePage() {
  return <NotePane />;
}

/**
 * The title, on the two occasions the server still gets a say: a full load and a
 * deep link.
 *
 * `<NotePane>` sets it from the client on every shallow move — which is what
 * re-arms Next's route announcer, since that speaks on a title change and
 * nothing else. But route metadata is streamed after hydration and overwrites
 * the first one, so without this a shared link opened cold read "Admin
 * Dashboard" in the tab, like every other page in the portal.
 *
 * It costs nothing: `loadVault()` is the same cached read the layout beside it
 * has already made this request, so this is a Map lookup wearing an async
 * signature.
 */
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
