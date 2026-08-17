"use client";

import { Suspense, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import type { AnswerEditorProps } from "./answer-editor";

/**
 * The seam that keeps read mode free of the editor.
 *
 * `dynamic(..., { ssr: false })` is illegal inside a Server Component in the App
 * Router, which is the entire reason this file exists: it is the smallest
 * possible `"use client"` shim, and the editor sits behind an `import()` so it
 * lands in a chunk of its own. Nothing fetches that chunk until `<AnswerEditor>`
 * is actually rendered, so a reader who never clicks Edit never downloads it.
 *
 * Edit mode is a URL, not a state. `[[...segments]]/page.tsx` reads `params` and
 * not `searchParams`, so the server component above cannot see `?edit=1` — this
 * reads it instead. Keeping it in the URL is worth more than the indirection:
 * the editor survives a reload, it can be linked to, and Back leaves it.
 */
const AnswerEditor = dynamic(() => import("./answer-editor"), {
  ssr: false,
  loading: () => <p className="nt-hint">Opening the editor…</p>,
});

interface EditorLoaderProps extends AnswerEditorProps {
  /** The server-rendered read view. Held, not re-created, while editing. */
  children: ReactNode;
}

function Gate({ children, ...props }: EditorLoaderProps) {
  return useSearchParams().get("edit") === "1" ? <AnswerEditor {...props} /> : <>{children}</>;
}

export function EditorLoader({ children, ...props }: EditorLoaderProps) {
  // `useSearchParams` makes its caller opt out of prerendering unless a boundary
  // stands above it. Nothing under /notes is prerendered — the dashboard layout
  // above reads a cookie, which ends the attempt long before this renders — so
  // the boundary has never fired and taking it away would not fail the build
  // either. It stays because the fallback is the read view rather than a spinner:
  // the day this route can be prerendered, the prose lands in the HTML anyway and
  // only the Edit affordance waits for JavaScript.
  return (
    <Suspense fallback={children}>
      <Gate {...props}>{children}</Gate>
    </Suspense>
  );
}
