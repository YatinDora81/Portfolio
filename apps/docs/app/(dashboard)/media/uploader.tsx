"use client";

import { useCallback, useRef, useState } from "react";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  MIN_ALT_LENGTH,
  formatBytes,
  isAllowedImageType,
  sanitizeFolder,
  type AllowedImageType,
  type MediaAssetDto,
} from "@repo/storage/media";
import { Button } from "@/components/ui/button";
import {
  IconAlertTriangle,
  IconCloudUpload,
  IconPlugConnectedX,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { completeUpload, discardUpload, signUpload } from "@/lib/actions/media";

type Phase = "reading" | "signing" | "uploading" | "alt" | "saving" | "rejected" | "failed";

interface Item {
  uid: string;
  file: File;
  preview: string;
  name: string;
  bytes: number;
  mimeType: AllowedImageType | null;
  width?: number;
  height?: number;
  blurDataUrl?: string;
  key?: string;
  phase: Phase;
  progress: number;
  altText: string;
  error?: string;
}

let seq = 0;

function transportError(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "The server could not be reached.";
}

async function describe(
  file: File,
): Promise<{ width: number; height: number; blurDataUrl?: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = bitmap;
    const w = 10;
    const h = Math.max(1, Math.round((height / width) * w));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { width, height };
    ctx.drawImage(bitmap, 0, 0, w, h);
    const url = canvas.toDataURL("image/webp", 0.7);
    const usable = url.startsWith("data:image/") && url.length <= 4096;
    return usable ? { width, height, blurDataUrl: url } : { width, height };
  } finally {
    bitmap.close();
  }
}

// fetch() reports no upload progress, so the PUT is an XHR.
function putToR2(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`R2 answered ${xhr.status}.`));
    xhr.onerror = () => reject(new Error("The upload could not reach R2."));
    xhr.ontimeout = () => reject(new Error("The upload timed out."));
    xhr.send(file);
  });
}

export function Uploader({
  folder,
  onFolderChange,
  configured,
  missing,
  onSaved,
}: {
  folder: string;
  onFolderChange: (next: string) => void;
  configured: boolean;
  missing: string[];
  onSaved: (asset: MediaAssetDto) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const patch = useCallback((uid: string, next: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.uid === uid ? { ...it, ...next } : it)));
  }, []);

  const drop = useCallback(
    (uid: string) => {
      setItems((prev) => {
        const gone = prev.find((it) => it.uid === uid);
        if (gone) URL.revokeObjectURL(gone.preview);
        return prev.filter((it) => it.uid !== uid);
      });
    },
    [],
  );

  const run = useCallback(
    async (item: Item, into: string) => {
      let width: number | undefined;
      let height: number | undefined;
      let blurDataUrl: string | undefined;
      try {
        const shape = await describe(item.file);
        width = shape.width;
        height = shape.height;
        blurDataUrl = shape.blurDataUrl;
        patch(item.uid, shape);
      } catch {
        // still uploads, just without dimensions
      }

      patch(item.uid, { phase: "signing" });
      try {
        const signed = await signUpload({
          filename: item.name,
          mimeType: item.mimeType ?? "",
          bytes: item.bytes,
          folder: into,
        });
        if (!signed.ok || !signed.uploadUrl || !signed.key || !signed.contentType) {
          patch(item.uid, { phase: "failed", error: signed.error ?? "The upload was refused." });
          return;
        }

        patch(item.uid, { phase: "uploading", progress: 0, key: signed.key });
        await putToR2(signed.uploadUrl, item.file, signed.contentType, (pct) =>
          patch(item.uid, { progress: pct }),
        );

        patch(item.uid, {
          phase: "alt",
          progress: 100,
          ...(width === undefined ? {} : { width }),
          ...(height === undefined ? {} : { height }),
          ...(blurDataUrl === undefined ? {} : { blurDataUrl }),
        });
      } catch (e) {
        patch(item.uid, { phase: "failed", error: transportError(e) });
      }
    },
    [patch],
  );

  const accept = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const into = sanitizeFolder(folder);

      const queued: Item[] = Array.from(files).map((file) => {
        seq += 1;
        const uid = `u${seq}-${Date.now()}`;
        const allowed = isAllowedImageType(file.type);
        const tooBig = file.size > MAX_UPLOAD_BYTES;
        return {
          uid,
          file,
          preview: URL.createObjectURL(file),
          name: file.name,
          bytes: file.size,
          mimeType: allowed ? (file.type as AllowedImageType) : null,
          phase: !allowed ? "rejected" : tooBig ? "rejected" : "reading",
          progress: 0,
          altText: "",
          ...(allowed
            ? tooBig
              ? { error: `${formatBytes(file.size)} is over the 10 MB limit.` }
              : {}
            : { error: `${file.type || "That file type"} is not an allowed image type.` }),
        };
      });

      setItems((prev) => [...prev, ...queued]);
      for (const item of queued) if (item.phase === "reading") void run(item, into);
    },
    [folder, run],
  );

  const save = useCallback(
    async (item: Item) => {
      if (!item.key || !item.mimeType) return;
      patch(item.uid, { phase: "saving", error: undefined });
      try {
        const res = await completeUpload({
          key: item.key,
          filename: item.name,
          mimeType: item.mimeType,
          altText: item.altText,
          ...(item.width === undefined ? {} : { width: item.width }),
          ...(item.height === undefined ? {} : { height: item.height }),
          ...(item.blurDataUrl === undefined ? {} : { blurDataUrl: item.blurDataUrl }),
        });
        if (!res.ok || !res.asset) {
          patch(item.uid, { phase: "alt", error: res.error ?? "The upload was not saved." });
          return;
        }
        onSaved(res.asset);
        drop(item.uid);
      } catch (e) {
        patch(item.uid, { phase: "alt", error: transportError(e) });
      }
    },
    [drop, onSaved, patch],
  );

  const abandon = useCallback(
    async (item: Item) => {
      if (item.key) {
        try {
          await discardUpload({ key: item.key });
        } catch {
          // worst case is orphaned bytes
        }
      }
      drop(item.uid);
    },
    [drop],
  );

  return (
    <div className="md-up">
      <div className="md-up-h">
        <label className="md-up-lb" htmlFor="md-folder">
          Upload into
        </label>
        <input
          id="md-folder"
          className="in mono md-up-folder"
          value={folder}
          onChange={(e) => onFolderChange(e.target.value)}
          placeholder="uploads"
          spellCheck={false}
        />
        <span className="md-up-hint">
          {configured
            ? `→ ${sanitizeFolder(folder)}/…  ·  jpeg, png, webp, avif, gif  ·  up to 10 MB`
            : "signing is off until R2 is configured"}
        </span>
      </div>

      {configured ? (
        <button
          type="button"
          className={`md-drop${over ? " over" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            accept(e.dataTransfer.files);
          }}
        >
          <i>
            <IconCloudUpload size={20} stroke={1.6} />
          </i>
          <b>Drop images here, or click to choose</b>
          <span>
            The browser uploads straight to R2. Each one needs alt text before it joins the library.
          </span>
        </button>
      ) : (
        <div className="md-drop off">
          <i>
            <IconPlugConnectedX size={20} stroke={1.6} />
          </i>
          <b>Uploads are off</b>
          <span>
            {missing.length > 0 ? missing.join(", ") : "The R2 variables"}{" "}
            {missing.length === 1 ? "is" : "are"} unset, so nothing can be signed. Everything
            already stored is listed below.
          </span>
        </div>
      )}

      <input
        ref={input}
        type="file"
        multiple
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        className="sr-only"
        onChange={(e) => {
          accept(e.target.files);
          e.target.value = "";
        }}
      />

      {items.length > 0 ? (
        <div className="md-q">
          {items.map((it) => (
            <QueueRow
              key={it.uid}
              item={it}
              onAlt={(altText) => patch(it.uid, { altText })}
              onSave={() => void save(it)}
              onDrop={() => void abandon(it)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const PHASE_LABEL: Record<Phase, string> = {
  reading: "reading the image…",
  signing: "asking for a signature…",
  uploading: "uploading",
  alt: "needs alt text",
  saving: "saving…",
  rejected: "refused",
  failed: "failed",
};

function QueueRow({
  item,
  onAlt,
  onSave,
  onDrop,
}: {
  item: Item;
  onAlt: (value: string) => void;
  onSave: () => void;
  onDrop: () => void;
}) {
  const bad = item.phase === "rejected" || item.phase === "failed";
  const canSave = item.phase === "alt" && item.altText.trim().length >= MIN_ALT_LENGTH;
  const dims = item.width && item.height ? `${item.width}×${item.height}` : null;

  return (
    <div className={`md-q-row${bad ? " bad" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="md-q-thumb" src={item.preview} alt="" />

      <div className="md-q-main">
        <div className="md-q-top">
          <span className="md-q-name">{item.name}</span>
          <span className="md-q-meta">
            {formatBytes(item.bytes)}
            {dims ? ` · ${dims}` : ""}
            {item.blurDataUrl ? " · blur ready" : ""}
          </span>
          <span className="sp" />
          <span className={`md-q-phase${bad ? " bad" : ""}`}>
            {PHASE_LABEL[item.phase]}
            {item.phase === "uploading" ? ` ${item.progress}%` : ""}
          </span>
          <button className="ibtn" onClick={onDrop} aria-label={`Remove ${item.name}`}>
            <IconX size={13} stroke={1.6} />
          </button>
        </div>

        {item.phase === "uploading" || item.phase === "signing" || item.phase === "reading" ? (
          <div className="md-q-track">
            <div
              className="md-q-fill"
              style={{ width: item.phase === "uploading" ? `${item.progress}%` : "8%" }}
            />
          </div>
        ) : null}

        {item.error ? (
          <div className="md-q-err">
            <IconAlertTriangle size={13} stroke={1.7} /> {item.error}
          </div>
        ) : null}

        {item.phase === "alt" || item.phase === "saving" ? (
          <div className="md-q-alt">
            <input
              className="in"
              value={item.altText}
              onChange={(e) => onAlt(e.target.value)}
              placeholder="Describe the image for someone who cannot see it"
              maxLength={500}
              disabled={item.phase === "saving"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSave) onSave();
              }}
            />
            <Button onClick={onSave} disabled={!canSave || item.phase === "saving"}>
              {item.phase === "saving" ? "Saving…" : "Save"}
            </Button>
            <button className="ibtn warn" onClick={onDrop} aria-label="Discard this upload">
              <IconTrash size={13} stroke={1.5} />
            </button>
          </div>
        ) : null}

        {item.phase === "alt" && !canSave ? (
          <div className="md-q-note">
            The bytes are in the bucket but nothing is recorded yet — alt text is what saves it.
            Remove it instead and the object is deleted.
          </div>
        ) : null}
      </div>
    </div>
  );
}
