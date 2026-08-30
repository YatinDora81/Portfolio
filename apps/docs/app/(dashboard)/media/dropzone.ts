import { MAX_PATH_DEPTH, joinPrefix, sanitizeSegment } from "@repo/storage/media";

export const MAX_DROP_FILES = 500;

const MAX_DIR_ENTRIES = 2000;

const JUNK_NAMES = new Set(["thumbs.db", "desktop.ini", "__macosx", "$recycle.bin"]);

export interface DroppedFile {
  file: File;
  relativePath: string;
}

export interface DropSnapshot {
  entries: FileSystemEntry[];
  files: File[];
}

function isJunk(name: string): boolean {
  return name === "" || name.startsWith(".") || JUNK_NAMES.has(name.toLowerCase());
}

function depthOf(prefix: string): number {
  return prefix.split("/").filter((p) => p !== "").length;
}

function folderSegments(relativePath: string): string[] {
  return relativePath
    .split("/")
    .slice(0, -1)
    .map(sanitizeSegment)
    .filter((p) => p !== "");
}

export function hasFiles(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer !== null && dataTransfer.types.includes("Files");
}

export function snapshotDrop(dataTransfer: DataTransfer | null): DropSnapshot {
  if (!dataTransfer) return { entries: [], files: [] };

  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < dataTransfer.items.length; i += 1) {
    const item = dataTransfer.items[i];
    if (!item || item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry();
    if (entry) entries.push(entry);
  }

  return { entries, files: Array.from(dataTransfer.files) };
}

function readFile(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(
      (file) => resolve(file),
      () => resolve(null),
    );
  });
}

function readDirectory(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];

  return new Promise((resolve) => {
    const pull = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all);
            return;
          }
          all.push(...batch);
          if (all.length >= MAX_DIR_ENTRIES) {
            resolve(all);
            return;
          }
          pull();
        },
        () => resolve(all),
      );
    };
    pull();
  });
}

async function collect(
  entry: FileSystemEntry,
  trail: string[],
  depth: number,
  out: DroppedFile[],
  limit: number,
): Promise<void> {
  if (out.length >= limit || isJunk(entry.name)) return;

  if (entry.isFile) {
    const file = await readFile(entry as FileSystemFileEntry);
    if (file) out.push({ file, relativePath: [...trail, file.name].join("/") });
    return;
  }

  if (!entry.isDirectory || depth >= MAX_PATH_DEPTH) return;

  const segment = sanitizeSegment(entry.name);
  const next = segment === "" ? trail : [...trail, segment];
  for (const child of await readDirectory(entry as FileSystemDirectoryEntry)) {
    await collect(child, next, depth + 1, out, limit);
    if (out.length >= limit) return;
  }
}

function fromFiles(files: readonly File[], limit: number): DroppedFile[] {
  const out: DroppedFile[] = [];
  for (const file of files) {
    if (out.length >= limit) break;
    if (isJunk(file.name)) continue;
    const raw = file.webkitRelativePath.split("/").slice(0, -1);
    if (raw.some(isJunk)) continue;
    const trail = raw.map(sanitizeSegment).filter((p) => p !== "");
    out.push({ file, relativePath: [...trail, file.name].join("/") });
  }
  return out;
}

export async function walkEntries(
  snapshot: DropSnapshot,
  limit: number = MAX_DROP_FILES,
): Promise<DroppedFile[]> {
  const out: DroppedFile[] = [];
  for (const entry of snapshot.entries) {
    if (out.length >= limit) break;
    await collect(entry, [], 0, out, limit);
  }
  if (out.length > 0) return out;

  return fromFiles(
    snapshot.files.filter((file) => file.size > 0 || file.type !== ""),
    limit,
  );
}

export function readFileList(
  files: FileList | null,
  limit: number = MAX_DROP_FILES,
): DroppedFile[] {
  return files === null ? [] : fromFiles(Array.from(files), limit);
}

export function destinationFor(into: string, relativePath: string): string | null {
  const dirs = folderSegments(relativePath);
  if (depthOf(into) + dirs.length > MAX_PATH_DEPTH) return null;
  return dirs.reduce(joinPrefix, into);
}

export function subfolderPrefixes(items: readonly DroppedFile[], into: string): string[] {
  const base = depthOf(into);
  const seen = new Set<string>();

  for (const item of items) {
    const dirs = folderSegments(item.relativePath);
    if (base + dirs.length > MAX_PATH_DEPTH) continue;
    let walked = into;
    for (const dir of dirs) {
      walked = joinPrefix(walked, dir);
      seen.add(walked);
    }
  }

  return [...seen].sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b));
}

export interface DragDepth {
  enter(): boolean;
  leave(): boolean;
  reset(): void;
}

export function createDragDepth(): DragDepth {
  let depth = 0;
  return {
    enter() {
      depth += 1;
      return depth > 0;
    },
    leave() {
      depth = Math.max(0, depth - 1);
      return depth > 0;
    },
    reset() {
      depth = 0;
    },
  };
}

export function pickDirectory(input: HTMLInputElement | null): void {
  if (!input) return;
  input.setAttribute("webkitdirectory", "");
  input.setAttribute("directory", "");
  input.click();
}
