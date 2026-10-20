"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { IconChevronDown, IconChevronUp, IconPaperclip } from "@tabler/icons-react";
import { attachToNote, detachFromNote, reorderAttachments, setAttachmentCaption } from "@/lib/actions/notes";
import { completeUpload, signUpload } from "@/lib/actions/media";
import { cdnUrl } from "@/lib/utils";
import type { VaultAttachment } from "@/lib/notes/view-types";

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif,application/pdf";
const MAX_BYTES = 10 * 1024 * 1024;

const isImage = (mimeType: string) => mimeType.startsWith("image/");

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function altFrom(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return stem.length >= 3 ? stem : `file ${stem}`.trim();
}

async function imageShape(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const shape = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return shape;
  } catch {
    return null;
  }
}

export function AttachmentEditor({ nodeId, items }: { nodeId: string; items: VaultAttachment[] }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useOptimistic(items);
  const picker = useRef<HTMLInputElement>(null);

  const send = async (file: File): Promise<string | null> => {
    if (file.size > MAX_BYTES) return `${file.name} is larger than 10 MB.`;

    const signed = await signUpload({
      filename: file.name,
      mimeType: file.type,
      bytes: file.size,
      folder: "notes",
    });
    if (!signed.ok || !signed.uploadUrl || !signed.key) {
      return signed.error ?? "That file cannot be uploaded.";
    }

    const put = await fetch(signed.uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "content-type": file.type },
    });
    if (!put.ok) return `${file.name} did not finish uploading.`;

    const shape = isImage(file.type) ? await imageShape(file) : null;
    const done = await completeUpload({
      key: signed.key,
      filename: file.name,
      mimeType: file.type,
      altText: altFrom(file.name),
      ...(shape ?? {}),
    });
    if (!done.ok || !done.asset) return done.error ?? "That upload cannot be saved.";

    const attached = await attachToNote(nodeId, done.asset.id);
    return attached.ok ? null : attached.error;
  };

  const pick = (files: FileList | null) => {
    const chosen = files ? [...files] : [];
    if (!chosen.length) return;
    start(async () => {
      setError(null);
      for (const file of chosen) {
        setBusy(file.name);
        const failed = await send(file);
        if (failed) {
          setError(failed);
          break;
        }
      }
      setBusy(null);
    });
  };

  const remove = (id: string) =>
    start(async () => {
      setShown(shown.filter((a) => a.id !== id));
      setError(null);
      const r = await detachFromNote(id);
      if (!r.ok) setError(r.error);
    });

  const nudge = (index: number, dir: -1 | 1) => {
    const next = [...shown];
    const to = index + dir;
    if (to < 0 || to >= next.length) return;
    const moved = next[index]!;
    next[index] = next[to]!;
    next[to] = moved;
    start(async () => {
      setShown(next);
      setError(null);
      const r = await reorderAttachments(nodeId, next.map((a) => a.id));
      if (!r.ok) setError(r.error);
    });
  };

  const caption = (id: string, value: string) =>
    start(async () => {
      setError(null);
      const r = await setAttachmentCaption(id, value);
      if (!r.ok) setError(r.error);
    });

  return (
    <div className="nt-fld">
      <label className="nt-lb" htmlFor={`${nodeId}-att`}>attachments</label>

      <input
        ref={picker}
        id={`${nodeId}-att`}
        className="nt-att-pick"
        type="file"
        multiple
        accept={ACCEPT}
        disabled={pending}
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = "";
        }}
      />

      {shown.length ? (
        <ul className="nt-att-rows">
          {shown.map((a, i) => (
            <li className="nt-att-row" key={a.id}>
              <span className="nt-att-kind">{isImage(a.mimeType) ? "IMG" : "PDF"}</span>
              <a className="nt-att-name" href={cdnUrl(a.url)} target="_blank" rel="noreferrer">
                {a.filename}
              </a>
              <input
                className="nt-att-cap"
                defaultValue={a.caption ?? ""}
                placeholder="caption"
                aria-label={`Caption for ${a.filename}`}
                disabled={pending}
                onBlur={(e) => {
                  if (e.target.value.trim() !== (a.caption ?? "")) caption(a.id, e.target.value);
                }}
              />
              <span className="nt-att-size">{sizeLabel(a.bytes)}</span>
              <button
                type="button"
                className="nt-tag-x"
                disabled={pending || i === 0}
                aria-label={`Move ${a.filename} up`}
                onClick={() => nudge(i, -1)}
              >
                <IconChevronUp size={13} stroke={2} />
              </button>
              <button
                type="button"
                className="nt-tag-x"
                disabled={pending || i === shown.length - 1}
                aria-label={`Move ${a.filename} down`}
                onClick={() => nudge(i, 1)}
              >
                <IconChevronDown size={13} stroke={2} />
              </button>
              <button
                type="button"
                className="nt-tag-x"
                disabled={pending}
                aria-label={`Remove ${a.filename}`}
                onClick={() => remove(a.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="nt-hint">
          <IconPaperclip size={12} stroke={2} /> images and pdfs, up to 10 MB each
        </p>
      )}

      {busy ? <p className="nt-hint">Uploading {busy}…</p> : null}
      {error ? <p className="nt-hint nt-bad" role="alert">{error}</p> : null}
    </div>
  );
}
