"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_PATH_DEPTH,
  MAX_UPLOAD_BYTES,
  MIN_ALT_LENGTH,
  formatBytes,
  isAllowedImageType,
  isAllowedUploadType,
  joinPrefix,
  sanitizeFolder,
  type AllowedUploadType,
  type MediaAssetDto,
} from "@repo/storage/media";
import { Button } from "@/components/ui/button";
import {
  IconAlertTriangle,
  IconCloudUpload,
  IconFile,
  IconFolderPlus,
  IconPlugConnectedX,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { completeUpload, discardUpload } from "@/lib/actions/media";
import { createFolder, signUploadInto } from "@/lib/actions/media-browser";
import {
  MAX_DROP_FILES,
  createDragDepth,
  destinationFor,
  hasFiles,
  pickDirectory,
  readFileList,
  snapshotDrop,
  walkEntries,
  type DroppedFile,
} from "./dropzone";

type Phase =
  | "queued"
  | "reading"
  | "signing"
  | "uploading"
  | "alt"
  | "saving"
  | "done"
  | "rejected"
  | "failed";

interface Item {
  uid: string;
  into: string;
  preview: string | null;
  name: string;
  bytes: number;
  mimeType: AllowedUploadType | null;
  image: boolean;
  width?: number;
  height?: number;
  blurDataUrl?: string;
  key?: string;
  phase: Phase;
  progress: number;
  altText: string;
  armed?: boolean;
  busy?: boolean;
  error?: string;
}

interface Job {
  uid: string;
  file: File;
  into: string;
  name: string;
  bytes: number;
  mimeType: AllowedUploadType;
  image: boolean;
}

interface Target {
  file: File;
  into: string | null;
}

export interface UploadJob {
  file: File;
  into: string;
}

export interface UploaderHandle {
  enqueue(jobs: readonly UploadJob[], root?: string): void;
  enqueueDropped(files: readonly DroppedFile[], root: string): void;
  pickFiles(root?: string): void;
  pickFolder(root?: string): void;
}

export interface UploaderProps {
  prefix: string;
  configured: boolean;
  missing: string[];
  onSaved: (asset: MediaAssetDto) => void;
  folder?: string;
  onFolderChange?: (next: string) => void;
  onLanded?: (key: string) => void;
  onDiscarded?: (key: string) => void;
}

const MAX_LANES = 4;
const QUEUE_VISIBLE = 8;

let seq = 0;

function transportError(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "The server could not be reached.";
}

function missingFolders(
  root: string,
  jobs: readonly Job[],
): { prefix: string; parent: string; name: string }[] {
  const wanted = new Map<string, { prefix: string; parent: string; name: string }>();

  for (const job of jobs) {
    if (job.into === root || !job.into.startsWith(root)) continue;
    let parent = root;
    for (const name of job.into.slice(root.length, -1).split("/")) {
      const prefix = joinPrefix(parent, name);
      if (!wanted.has(prefix)) wanted.set(prefix, { prefix, parent, name });
      parent = prefix;
    }
  }

  return [...wanted.values()].sort((a, b) => a.prefix.length - b.prefix.length);
}

function needsHand(item: Item): boolean {
  return item.phase === "alt" || item.phase === "failed" || item.phase === "rejected";
}

async function describe(
  file: File,
): Promise<{ width: number; height: number; blurDataUrl?: string } | null> {
  try {
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
  } catch {
    return null;
  }
}

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

export const Uploader = forwardRef<UploaderHandle, UploaderProps>(function Uploader(
  { prefix, configured, missing, onSaved, folder, onFolderChange, onLanded, onDiscarded },
  ref,
) {
  const [items, setItems] = useState<Item[]>([]);
  const [made, setMade] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [over, setOver] = useState(false);

  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const pending = useRef<Job[]>([]);
  const lanes = useRef(0);
  const gone = useRef(new Set<string>());
  const previews = useRef(new Set<string>());
  const pickTarget = useRef(prefix);
  const depth = useRef(createDragDepth());

  useEffect(() => {
    const urls = previews.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  const patch = useCallback((uid: string, next: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.uid === uid ? { ...it, ...next } : it)));
  }, []);

  const drop = useCallback((uid: string) => {
    gone.current.add(uid);
    setItems((prev) => {
      const leaving = prev.find((it) => it.uid === uid);
      if (leaving?.preview) {
        URL.revokeObjectURL(leaving.preview);
        previews.current.delete(leaving.preview);
      }
      return prev.filter((it) => it.uid !== uid);
    });
  }, []);

  const commit = useCallback(
    async (
      uid: string,
      payload: {
        key: string;
        filename: string;
        mimeType: AllowedUploadType;
        altText: string;
        width?: number;
        height?: number;
        blurDataUrl?: string;
      },
      back: Phase,
    ) => {
      patch(uid, { phase: "saving", error: undefined });
      try {
        const res = await completeUpload(payload);
        if (!res.ok || !res.asset) {
          patch(uid, { phase: back, error: res.error ?? "The upload was not saved." });
          return;
        }
        onSaved(res.asset);
        patch(uid, { phase: "done", progress: 100, error: undefined });
      } catch (e) {
        patch(uid, { phase: back, error: transportError(e) });
      }
    },
    [onSaved, patch],
  );

  const run = useCallback(
    async (job: Job) => {
      let width: number | undefined;
      let height: number | undefined;
      let blurDataUrl: string | undefined;

      if (job.image) {
        patch(job.uid, { phase: "reading" });
        const shape = await describe(job.file);
        if (shape) {
          width = shape.width;
          height = shape.height;
          blurDataUrl = shape.blurDataUrl;
          patch(job.uid, shape);
        }
      }

      patch(job.uid, { phase: "signing" });
      try {
        const signed = await signUploadInto({
          prefix: job.into,
          filename: job.name,
          mimeType: job.mimeType,
          bytes: job.bytes,
        });
        if (!signed.ok || !signed.uploadUrl || !signed.key || !signed.contentType) {
          patch(job.uid, { phase: "failed", error: signed.error ?? "The upload was refused." });
          return;
        }

        const key = signed.key;
        patch(job.uid, { phase: "uploading", progress: 0, key });
        await putToR2(signed.uploadUrl, job.file, signed.contentType, (pct) =>
          patch(job.uid, { progress: pct }),
        );
        onLanded?.(key);

        const shape = {
          ...(width === undefined ? {} : { width }),
          ...(height === undefined ? {} : { height }),
          ...(blurDataUrl === undefined ? {} : { blurDataUrl }),
        };

        if (job.image) {
          patch(job.uid, { phase: "alt", progress: 100, ...shape });
          return;
        }

        patch(job.uid, { progress: 100 });
        await commit(
          job.uid,
          { key, filename: job.name, mimeType: job.mimeType, altText: "", ...shape },
          "failed",
        );
      } catch (e) {
        patch(job.uid, { phase: "failed", error: transportError(e) });
      }
    },
    [commit, onLanded, patch],
  );

  const pump = useCallback(() => {
    while (lanes.current < MAX_LANES && pending.current.length > 0) {
      lanes.current += 1;
      void (async () => {
        for (;;) {
          const job = pending.current.shift();
          if (!job) break;
          if (gone.current.has(job.uid)) continue;
          await run(job);
        }
        lanes.current -= 1;
      })();
    }
  }, [run]);

  const begin = useCallback(
    async (root: string, jobs: readonly Job[]) => {
      for (const sub of missingFolders(root, jobs)) {
        try {
          const res = await createFolder({ prefix: sub.parent, name: sub.name });
          if (res.ok && res.created) setMade((prev) => [...prev, sub.prefix]);
          if (!res.ok) setNotice(res.error ?? `“${sub.prefix}” could not be created.`);
        } catch (e) {
          setNotice(transportError(e));
        }
      }
      pump();
    },
    [pump],
  );

  const add = useCallback(
    (targets: readonly Target[], root: string) => {
      if (targets.length === 0) return;
      setNotice(null);
      setMade([]);

      const rows: Item[] = [];
      const jobs: Job[] = [];

      for (const { file, into } of targets) {
        seq += 1;
        const uid = `u${seq}-${Date.now()}`;
        const mimeType = isAllowedUploadType(file.type) ? file.type : null;
        const image = mimeType !== null && isAllowedImageType(mimeType);
        const refusal =
          into === null
            ? `Folders only go ${MAX_PATH_DEPTH} deep, so that one has nowhere to land.`
            : mimeType === null
              ? `${file.type || "That file type"} is not an allowed upload type.`
              : file.size === 0
                ? "That file is empty."
                : file.size > MAX_UPLOAD_BYTES
                  ? `${formatBytes(file.size)} is over the 10 MB limit.`
                  : null;

        const preview = image && refusal === null ? URL.createObjectURL(file) : null;
        if (preview !== null) previews.current.add(preview);

        rows.push({
          uid,
          into: into ?? root,
          preview,
          name: file.name,
          bytes: file.size,
          mimeType,
          image,
          phase: refusal === null ? "queued" : "rejected",
          progress: 0,
          altText: "",
          ...(refusal === null ? {} : { error: refusal }),
        });

        if (refusal === null && into !== null && mimeType !== null) {
          jobs.push({
            uid,
            file,
            into,
            name: file.name,
            bytes: file.size,
            mimeType,
            image,
          });
        }
      }

      setItems((prev) => [...prev, ...rows]);
      pending.current.push(...jobs);
      void begin(root, jobs);
    },
    [begin],
  );

  const addDropped = useCallback(
    (files: readonly DroppedFile[], root: string) => {
      if (files.length === 0) return;
      add(
        files.map((item) => ({ file: item.file, into: destinationFor(root, item.relativePath) })),
        root,
      );
      if (files.length >= MAX_DROP_FILES) {
        setNotice(`Only the first ${MAX_DROP_FILES} files were taken from that drop.`);
      }
    },
    [add],
  );

  const choose = useCallback((root: string, wholeFolder: boolean) => {
    pickTarget.current = root;
    if (wholeFolder) pickDirectory(folderInput.current);
    else input.current?.click();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      enqueue(jobs, root = prefix) {
        add(
          jobs.map((job) => ({ file: job.file, into: job.into })),
          root,
        );
      },
      enqueueDropped(files, root) {
        addDropped(files, root);
      },
      pickFiles(root = prefix) {
        choose(root, false);
      },
      pickFolder(root = prefix) {
        choose(root, true);
      },
    }),
    [add, addDropped, choose, prefix],
  );

  const save = useCallback(
    (item: Item) => {
      if (!item.key || !item.mimeType) return;
      void commit(
        item.uid,
        {
          key: item.key,
          filename: item.name,
          mimeType: item.mimeType,
          altText: item.altText,
          ...(item.width === undefined ? {} : { width: item.width }),
          ...(item.height === undefined ? {} : { height: item.height }),
          ...(item.blurDataUrl === undefined ? {} : { blurDataUrl: item.blurDataUrl }),
        },
        "alt",
      );
    },
    [commit],
  );

  const erase = useCallback(
    async (item: Item) => {
      if (!item.key) {
        drop(item.uid);
        return;
      }
      patch(item.uid, { busy: true, error: undefined });
      try {
        const res = await discardUpload({ key: item.key });
        if (!res.ok) {
          patch(item.uid, {
            busy: false,
            armed: false,
            error: res.error ?? "The file was kept.",
          });
          return;
        }
        onDiscarded?.(item.key);
        drop(item.uid);
      } catch (e) {
        patch(item.uid, { busy: false, error: transportError(e) });
      }
    },
    [drop, onDiscarded, patch],
  );

  const clearDone = useCallback(() => {
    setItems((prev) => {
      for (const it of prev) {
        if (it.phase !== "done" || !it.preview) continue;
        URL.revokeObjectURL(it.preview);
        previews.current.delete(it.preview);
      }
      return prev.filter((it) => it.phase !== "done");
    });
  }, []);

  const summary = useMemo(() => {
    let total = 0;
    let moved = 0;
    let active = 0;
    let alt = 0;
    let done = 0;
    let bad = 0;

    for (const it of items) {
      if (it.phase === "rejected" || it.phase === "failed") {
        bad += 1;
        continue;
      }
      total += it.bytes;
      if (it.phase === "uploading") {
        moved += (it.bytes * it.progress) / 100;
        active += 1;
      } else if (it.phase === "queued" || it.phase === "reading" || it.phase === "signing") {
        active += 1;
      } else {
        moved += it.bytes;
      }
      if (it.phase === "alt") alt += 1;
      if (it.phase === "done") done += 1;
    }

    const pct = total === 0 ? 0 : Math.min(100, Math.round((moved / total) * 100));
    return { pct, active, alt, done, bad };
  }, [items]);

  const visible = useMemo(() => {
    if (expanded || items.length <= QUEUE_VISIBLE) return items;
    return [...items.filter(needsHand), ...items.filter((it) => !needsHand(it))].slice(
      0,
      QUEUE_VISIBLE,
    );
  }, [expanded, items]);

  const spread = useMemo(() => new Set(items.map((it) => it.into)).size > 1, [items]);

  const hint = !configured
    ? "signing is off until R2 is configured"
    : `→ ${onFolderChange ? `${sanitizeFolder(folder)}/` : prefix}…  ·  images, md, pdf, txt, json, csv  ·  up to 10 MB`;

  return (
    <div className="md-up">
      <div className="md-up-h">
        {onFolderChange ? (
          <>
            <label className="md-up-lb" htmlFor="md-folder">
              Upload into
            </label>
            <input
              id="md-folder"
              className="in mono md-up-folder"
              value={folder ?? ""}
              onChange={(e) => onFolderChange(e.target.value)}
              placeholder="uploads"
              spellCheck={false}
            />
          </>
        ) : null}
        <span className="md-up-hint">{hint}</span>
        {configured ? (
          <Button variant="outline" size="sm" onClick={() => choose(prefix, true)}>
            <IconFolderPlus size={13} stroke={1.7} /> Upload a folder
          </Button>
        ) : null}
      </div>

      {configured ? (
        <button
          type="button"
          className={`md-drop${over ? " over" : ""}`}
          onClick={() => choose(prefix, false)}
          onDragEnter={(e) => {
            if (hasFiles(e.dataTransfer)) setOver(depth.current.enter());
          }}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDragLeave={() => setOver(depth.current.leave())}
          onDrop={(e) => {
            e.preventDefault();
            depth.current.reset();
            setOver(false);
            const snapshot = snapshotDrop(e.dataTransfer);
            const root = prefix;
            void walkEntries(snapshot).then((files) => addDropped(files, root));
          }}
        >
          <i>
            <IconCloudUpload size={20} stroke={1.6} />
          </i>
          <b>Drop files or a whole folder here, or click to choose</b>
          <span>
            The browser uploads straight to R2, four at a time. Images need alt text before they
            join the library; documents join it as soon as they land.
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
        accept={ALLOWED_UPLOAD_TYPES.join(",")}
        className="sr-only"
        onChange={(e) => {
          addDropped(readFileList(e.target.files), pickTarget.current);
          e.target.value = "";
        }}
      />

      <input
        ref={folderInput}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          addDropped(readFileList(e.target.files), pickTarget.current);
          e.target.value = "";
        }}
      />

      {notice ? (
        <div className="md-q-err">
          <IconAlertTriangle size={13} stroke={1.7} /> {notice}
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <div className="md-q">
            {visible.map((it) => (
              <QueueRow
                key={it.uid}
                item={it}
                showInto={spread}
                onAlt={(altText) => patch(it.uid, { altText })}
                onSave={() => save(it)}
                onDismiss={() => drop(it.uid)}
                onArm={(armed) => patch(it.uid, { armed })}
                onErase={() => void erase(it)}
              />
            ))}
          </div>

          <div className="mdb-tray">
            <IconCloudUpload size={14} stroke={1.6} />
            <span>
              {items.length} file{items.length === 1 ? "" : "s"}
            </span>
            <span className="mdb-tray-t">
              <span className="mdb-tray-f" style={{ width: `${summary.pct}%` }} />
            </span>
            <span className="mdb-tray-m">{summary.pct}%</span>
            <span className="mdb-tray-m">
              {summary.active} left · {summary.alt} need alt · {summary.done} in the library
              {summary.bad > 0 ? ` · ${summary.bad} refused` : ""}
            </span>
            {made.length > 0 ? (
              <span className="mdb-tray-m">
                made {made.slice(0, 2).join(", ")}
                {made.length > 2 ? ` +${made.length - 2}` : ""}
              </span>
            ) : null}
            <span className="sp" />
            {items.length > QUEUE_VISIBLE ? (
              <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
                {expanded ? "Show fewer" : `Show all ${items.length}`}
              </Button>
            ) : null}
            {summary.done > 0 ? (
              <Button variant="ghost" size="sm" onClick={clearDone}>
                Clear finished
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
});

const PHASE_LABEL: Record<Phase, string> = {
  queued: "waiting its turn…",
  reading: "reading the file…",
  signing: "asking for a signature…",
  uploading: "uploading",
  alt: "needs alt text",
  saving: "saving…",
  done: "in the library",
  rejected: "refused",
  failed: "failed",
};

function QueueRow({
  item,
  showInto,
  onAlt,
  onSave,
  onDismiss,
  onArm,
  onErase,
}: {
  item: Item;
  showInto: boolean;
  onAlt: (value: string) => void;
  onSave: () => void;
  onDismiss: () => void;
  onArm: (armed: boolean) => void;
  onErase: () => void;
}) {
  const bad = item.phase === "rejected" || item.phase === "failed";
  const canSave = item.phase === "alt" && item.altText.trim().length >= MIN_ALT_LENGTH;
  const landed = item.key !== undefined && item.phase !== "done";
  const dims = item.width && item.height ? `${item.width}×${item.height}` : null;

  return (
    <div className={`md-q-row${bad ? " bad" : ""}`}>
      {item.preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="md-q-thumb" src={item.preview} alt="" />
      ) : (
        <div className="md-q-thumb" style={{ display: "grid", placeItems: "center" }}>
          <IconFile size={18} stroke={1.5} />
        </div>
      )}

      <div className="md-q-main">
        <div className="md-q-top">
          <span className="md-q-name">{item.name}</span>
          <span className="md-q-meta">
            {formatBytes(item.bytes)}
            {dims ? ` · ${dims}` : ""}
            {item.blurDataUrl ? " · blur ready" : ""}
            {showInto ? ` · ${item.into}` : ""}
          </span>
          <span className="sp" />
          <span className={`md-q-phase${bad ? " bad" : ""}`}>
            {PHASE_LABEL[item.phase]}
            {item.phase === "uploading" ? ` ${item.progress}%` : ""}
          </span>
          <button
            className="ibtn"
            onClick={onDismiss}
            title={landed ? "Dismiss — the file stays in the bucket" : "Remove from the queue"}
            aria-label={`Dismiss ${item.name}`}
          >
            <IconX size={13} stroke={1.6} />
          </button>
        </div>

        {item.phase === "queued" ||
        item.phase === "reading" ||
        item.phase === "signing" ||
        item.phase === "uploading" ? (
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
            <button
              className="ibtn warn"
              onClick={() => onArm(true)}
              disabled={item.armed}
              title="Delete the file from the bucket"
              aria-label={`Delete ${item.name} from the bucket`}
            >
              <IconTrash size={13} stroke={1.5} />
            </button>
          </div>
        ) : null}

        {item.phase === "alt" && !canSave && !item.armed ? (
          <div className="md-q-note">
            The bytes are already in the bucket. Alt text files it in the library; dismiss it
            instead and the file stays put, listed in the browser as untracked and ready to adopt.
          </div>
        ) : null}

        {item.armed && landed ? (
          <>
            <div className="md-q-note">
              Delete removes the bytes from R2 for good — there is no undo, and nothing on the site
              can point at them yet.
            </div>
            <div className="md-q-alt">
              <Button variant="destructive" onClick={onErase} disabled={item.busy}>
                {item.busy ? "Deleting…" : "Delete the file"}
              </Button>
              <Button variant="outline" onClick={() => onArm(false)} disabled={item.busy}>
                Keep it
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
