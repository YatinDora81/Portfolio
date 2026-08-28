"use client";

import { Suspense, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import type { AnswerEditorProps } from "./answer-editor";

const AnswerEditor = dynamic(() => import("./answer-editor"), {
  ssr: false,
  loading: () => <p className="nt-hint">Opening the editor…</p>,
});

interface EditorLoaderProps extends AnswerEditorProps {
  children: ReactNode;
}

function Gate({ children, ...props }: EditorLoaderProps) {
  return useSearchParams().get("edit") === "1" ? <AnswerEditor {...props} /> : <>{children}</>;
}

export function EditorLoader({ children, ...props }: EditorLoaderProps) {
  return (
    <Suspense fallback={children}>
      <Gate {...props}>{children}</Gate>
    </Suspense>
  );
}
