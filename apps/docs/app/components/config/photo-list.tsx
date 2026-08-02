"use client";

import { useId } from "react";
import { IconButton, Button } from "@/components/ui/button";
import { cdnUrl } from "@/lib/utils";
import {
  IconChevronDown, IconChevronUp, IconPhotoPlus, IconTrash, IconPhotoOff,
} from "@tabler/icons-react";

/**
 * The `photoList` control — a repeatable path list stored as ONE comma-separated
 * SiteConfig row.
 *
 * The encoding is not a detail: apps/web/app/lib/data.ts and all three hero
 * previews parse `heroPhotos` by splitting on "," and trimming, so this control
 * joins with "," and nothing else. A path containing a comma cannot be stored,
 * which is why commas are stripped on entry rather than silently splitting a
 * row in two on the next read.
 *
 * Classes are `.hro-ph*`: `heroPhotos` is the only key with this control, and
 * the hero owns the styles.
 */
export function PhotoList({ label, hint, value, onChange }: {
  label?: string;
  hint?: string;
  /** The raw row — comma separated, possibly empty. */
  value: string;
  onChange: (next: string) => void;
}) {
  const id = useId();
  // Blank segments are KEPT while editing — a freshly added row is a blank one,
  // and filtering here would delete it on the very next render. Reordering and
  // removing drop them; a row left blank is saved as an empty segment, which
  // every reader of this row (apps/web and all three previews) already filters
  // out, so it is invisible rather than a broken path.
  const paths = value === "" ? [] : value.split(",").map((p) => p.trim());

  const commit = (next: string[]) => onChange(next.filter((p) => p !== "").join(","));
  const write = (i: number, raw: string) => {
    const next = [...paths];
    // A comma would silently split one path into two broken ones on the next read.
    next[i] = raw.replace(/,/g, "");
    onChange(next.join(","));
  };
  const move = (from: number, to: number) => {
    const next = [...paths];
    [next[from], next[to]] = [next[to]!, next[from]!];
    commit(next);
  };
  const remove = (i: number) => commit(paths.filter((_, j) => j !== i));
  // An empty deck decodes from "", and appending a blank segment to nothing
  // re-encodes to "" — the same string, so the row round-trips away and the
  // button does nothing at all. A lone space is the one encoding that means
  // "one blank row": every reader trims and drops empties, so it reaches the
  // site as no photo until a path is actually typed into it.
  const add = () => onChange(paths.length === 0 ? " " : [...paths, ""].join(","));

  return (
    <div className="f">
      {label && <label htmlFor={`${id}-0`}>{label}</label>}

      {paths.length === 0 ? (
        <div className="hro-ph-empty">
          <div className="empty-ic"><IconPhotoOff size={17} stroke={1.5} /></div>
          <b>No photo deck</b>
          <span>The hero draws the avatar on its own — no fanned stack behind it.</span>
        </div>
      ) : (
        <div className="hro-ph">
          {paths.map((p, i) => (
            <div className="hro-ph-row" key={i}>
              <span className="hro-ph-n">{i === 0 ? "top" : String(i + 1).padStart(2, "0")}</span>
              <span className="hro-ph-thumb" aria-hidden="true">
                {p ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cdnUrl(p)} alt="" loading="lazy" />
                ) : null}
              </span>
              <input
                id={`${id}-${i}`}
                className="in mono"
                value={p}
                spellCheck={false}
                placeholder="/photos/desk.jpg"
                aria-label={`Photo ${i + 1} path`}
                onChange={(e) => write(i, e.target.value)}
              />
              <div className="row-acts">
                <IconButton aria-label={`Move photo ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <IconChevronUp size={13} stroke={1.6} />
                </IconButton>
                <IconButton
                  aria-label={`Move photo ${i + 1} later`}
                  disabled={i === paths.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <IconChevronDown size={13} stroke={1.6} />
                </IconButton>
                <IconButton tone="warn" aria-label={`Remove photo ${i + 1}`} onClick={() => remove(i)}>
                  <IconTrash size={13} stroke={1.6} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="hro-ph-foot">
        <Button variant="outline" size="sm" onClick={add}>
          <IconPhotoPlus size={13} stroke={1.6} /> Add photo
        </Button>
        {hint && <span className="f-hint" style={{ margin: 0 }}>{hint}</span>}
      </div>
    </div>
  );
}
