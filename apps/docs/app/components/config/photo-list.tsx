"use client";

import { useId } from "react";
import { IconButton, Button } from "@/components/ui/button";
import { cdnUrl } from "@/lib/utils";
import {
  IconChevronDown, IconChevronUp, IconPhotoPlus, IconTrash, IconPhotoOff,
} from "@tabler/icons-react";

export function PhotoList({ label, hint, value, onChange }: {
  label?: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const id = useId();
  const paths = value === "" ? [] : value.split(",").map((p) => p.trim());

  const commit = (next: string[]) => onChange(next.filter((p) => p !== "").join(","));
  const write = (i: number, raw: string) => {
    const next = [...paths];
    // commas would split one path into two
    next[i] = raw.replace(/,/g, "");
    onChange(next.join(","));
  };
  const move = (from: number, to: number) => {
    const next = [...paths];
    [next[from], next[to]] = [next[to]!, next[from]!];
    commit(next);
  };
  const remove = (i: number) => commit(paths.filter((_, j) => j !== i));
  // a lone space is the only encoding for one blank row
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
