"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  IconArrowRight,
  IconCheck,
  IconCopy,
  IconLink,
  IconPlus,
  IconQrcode,
  IconRefresh,
} from "@tabler/icons-react";
import { CHANNELS } from "@repo/shared/attribution";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHead } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { transportError } from "@/lib/lifecycle";
import {
  createTrackedLink,
  setTrackedLinkActive,
  type TrackedLinkDto,
} from "@/lib/actions/tracked-links";
import type { DestinationOption } from "@/lib/tracked-links";

export interface LinkRow {
  id: string;
  slug: string;
  label: string;
  channel: string;
  campaign: string | null;
  destination: string;
  notes: string | null;
  active: boolean;
  clickCount: number;
  shortUrl: string;
  createdAt: string;
  createdLabel: string;
  lastClickAt: string | null;
  lastClickLabel: string | null;
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard blocked, the text stays selectable
    }
  };

  return (
    <button
      type="button"
      className="chip"
      onClick={() => void copy()}
      style={
        copied
          ? { borderColor: "var(--good)", color: "var(--goodT)", background: "var(--good-soft)" }
          : undefined
      }
      title={copied ? "Copied" : `Copy ${label ?? "link"}`}
    >
      {copied ? <IconCheck size={10} stroke={2.4} /> : <IconCopy size={10} stroke={1.8} />}
      {copied ? "copied" : "copy"}
    </button>
  );
}

function LinkLine({ caption, url, note }: { caption: string; url: string; note?: string }) {
  return (
    <div className="tl-line">
      <div className="tl-line-k">{caption}</div>
      <div className="tl-line-v">
        <code>{url}</code>
        <CopyButton text={url} label={caption} />
      </div>
      {note ? <div className="tl-line-n">{note}</div> : null}
    </div>
  );
}

const CUSTOM = "__custom";

const CHANNEL_OPTIONS = [
  { value: "", label: "Choose a channel…" },
  ...CHANNELS.map((c) => ({ value: c, label: c })),
];

export function CreateLinkForm({ destinations }: { destinations: DestinationOption[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [channel, setChannel] = useState("");
  const [campaign, setCampaign] = useState("");
  const [choice, setChoice] = useState(destinations[0]?.value ?? "/");
  const [custom, setCustom] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<TrackedLinkDto | null>(null);
  const [, start] = useTransition();

  const destinationOpts = [
    ...destinations,
    { value: CUSTOM, label: "Custom path on this site…" },
  ];

  const reset = () => {
    setLabel("");
    setChannel("");
    setCampaign("");
    setChoice(destinations[0]?.value ?? "/");
    setCustom("");
    setNotes("");
    setError(null);
    setMade(null);
  };

  const submit = () => {
    const destination = choice === CUSTOM ? custom.trim() : choice;
    if (!label.trim()) return setError("Give the link a label.");
    if (!channel) return setError("Pick a channel.");
    if (!destination) return setError("Pick or type a destination.");

    setBusy(true);
    setError(null);
    start(async () => {
      try {
        const res = await createTrackedLink({ label, channel, campaign, destination, notes });
        if (!res.ok || !res.link) {
          setError(res.error ?? "The link was not saved.");
          return;
        }
        setMade(res.link);
        router.refresh();
      } catch (e) {
        setError(transportError(e));
      } finally {
        setBusy(false);
      }
    });
  };

  if (made) {
    return (
      <Card flush className="rv-card">
        <CardHead
          title={made.label}
          right={
            <Button variant="outline" size="sm" onClick={reset}>
              <IconPlus size={13} stroke={1.7} /> New link
            </Button>
          }
        />
        <div className="tl-made">
          <div className="tl-made-links">
            <LinkLine
              caption="short link"
              url={made.shortUrl}
              note="The only form that counts a click. Put this one on a resume, a slide or a QR code."
            />
            <LinkLine
              caption="full link"
              url={made.fullUrl}
              note="The same destination spelled out, for anywhere a shortener reads as suspicious. It attributes the visit but does not add to the click count."
            />
            <div className="tl-line-n">
              Goes to <code>{made.destination}</code> · channel{" "}
              <b className="mono">{made.channel}</b>
              {made.campaign ? (
                <>
                  {" "}
                  · campaign <b className="mono">{made.campaign}</b>
                </>
              ) : null}
            </div>
          </div>

          {made.qr ? (
            <figure className="tl-qr">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={made.qr} alt={`QR code for ${made.shortUrl}`} />
              <figcaption>
                <IconQrcode size={11} stroke={1.7} /> {made.slug}
              </figcaption>
            </figure>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <Card flush className="rv-card">
      <CardHead title="New tracked link" />
      <div className="card-b">
        <div className="tl-form">
          <Input
            label="Label"
            value={label}
            maxLength={120}
            disabled={busy}
            placeholder="Acme backend application"
            hint="What this link was for. It is the only thing that will still say so in six months."
            onChange={(e) => setLabel(e.target.value)}
          />
          <Select
            label="Channel"
            value={channel}
            disabled={busy}
            options={CHANNEL_OPTIONS}
            hint="The fixed taxonomy the analytics already group by — not a name you have to remember."
            onChange={(e) => setChannel(e.target.value)}
          />
          <Select
            label="Destination"
            value={choice}
            disabled={busy}
            options={destinationOpts}
            onChange={(e) => setChoice(e.target.value)}
          />
          <Input
            label="Campaign"
            value={campaign}
            maxLength={120}
            disabled={busy}
            placeholder="autumn-applications"
            hint="Optional. Groups several links into one push."
            onChange={(e) => setCampaign(e.target.value)}
          />
        </div>

        {choice === CUSTOM ? (
          <Input
            label="Custom destination"
            mono
            value={custom}
            maxLength={2048}
            disabled={busy}
            placeholder="/blog/some-post"
            hint="A path starting with / or a URL on yatindora.in. Anything else is refused — a short link on this domain lends it your trust."
            onChange={(e) => setCustom(e.target.value)}
          />
        ) : null}

        <Textarea
          label="Notes"
          value={notes}
          maxLength={500}
          disabled={busy}
          placeholder="Where this went, who it was for."
          onChange={(e) => setNotes(e.target.value)}
        />

        {error ? <div className="rv-err">{error}</div> : null}

        <div className="tl-actions">
          <Button disabled={busy} onClick={submit}>
            {busy ? <IconRefresh size={13} className="spin" /> : <IconLink size={13} stroke={1.7} />}
            {busy ? "Saving…" : "Create link"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

type Sort = "clicks" | "recent" | "last";

const SORTS: { key: Sort; label: string }[] = [
  { key: "clicks", label: "most clicks" },
  { key: "last", label: "last clicked" },
  { key: "recent", label: "newest" },
];

export function ActiveToggle({
  id,
  label,
  active: initial,
  onChanged,
}: {
  id: string;
  label: string;
  active: boolean;
  onChanged?: (active: boolean) => void;
}) {
  const [active, setActive] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const flip = (next: boolean) => {
    const previous = active;
    const settle = (value: boolean) => {
      setActive(value);
      onChanged?.(value);
    };

    settle(next);
    setBusy(true);
    setError(null);
    start(async () => {
      try {
        const res = await setTrackedLinkActive(id, next);
        if (!res.ok) {
          settle(previous);
          setError(res.error ?? "That did not save.");
        }
      } catch (e) {
        settle(previous);
        setError(transportError(e));
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <div className="tl-toggle">
      <Switch
        checked={active}
        disabled={busy}
        ariaLabel={`${label} is ${active ? "live" : "retired"}`}
        onChange={flip}
      />
      {error ? <div className="rv-err">{error}</div> : null}
    </div>
  );
}

export function LinkTable({ rows }: { rows: LinkRow[] }) {
  const [channel, setChannel] = useState<string>("");
  const [sort, setSort] = useState<Sort>("clicks");
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const isLive = (row: LinkRow) => flipped[row.id] ?? row.active;

  const channels = useMemo(
    () => [...new Set(rows.map((r) => r.channel))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const shown = useMemo(() => {
    const filtered = channel ? rows.filter((r) => r.channel === channel) : rows;
    const byTime = (a: string | null, b: string | null) => (b ?? "").localeCompare(a ?? "");

    return [...filtered].sort((a, b) => {
      if (sort === "clicks") return b.clickCount - a.clickCount || byTime(a.createdAt, b.createdAt);
      if (sort === "last") return byTime(a.lastClickAt, b.lastClickAt);
      return byTime(a.createdAt, b.createdAt);
    });
  }, [rows, channel, sort]);

  return (
    <Card flush className="rv-card">
      <CardHead title="Links" count={rows.length} />

      <div className="filters">
        <button className={`filt${channel === "" ? " on" : ""}`} onClick={() => setChannel("")}>
          all channels
        </button>
        {channels.map((c) => (
          <button
            key={c}
            className={`filt${channel === c ? " on" : ""}`}
            onClick={() => setChannel(c)}
          >
            {c}
          </button>
        ))}
        <div className="tl-sp" />
        {SORTS.map((s) => (
          <button
            key={s.key}
            className={`filt${sort === s.key ? " on" : ""}`}
            onClick={() => setSort(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <div className="empty-ic">
            <IconLink size={17} stroke={1.6} />
          </div>
          <b>No links here yet</b>
          <span>
            {rows.length === 0
              ? "Make one above, put it on a resume, and this table starts answering whether anyone opened it."
              : "Nothing in that channel."}
          </span>
        </div>
      ) : (
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Link</th>
                <th>Channel</th>
                <th>Short link</th>
                <th className="tl-right">Clicks</th>
                <th>Last click</th>
                <th>Created</th>
                <th>Live</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="tl-labelcell">
                      <span className={isLive(row) ? "row-t" : "row-t dimmed"}>{row.label}</span>
                      {isLive(row) ? null : <Badge variant="outline">retired</Badge>}
                    </div>
                    <div className="row-m">
                      {row.destination}
                      {row.campaign ? ` · ${row.campaign}` : ""}
                    </div>
                  </td>
                  <td>
                    <Badge>{row.channel}</Badge>
                  </td>
                  <td>
                    <div className="tl-slugcell">
                      <code>/r/{row.slug}</code>
                      <CopyButton text={row.shortUrl} label="short link" />
                    </div>
                  </td>
                  <td className="tl-right rv-mono">{row.clickCount}</td>
                  <td className="rv-mono rv-nowrap">
                    {row.lastClickLabel ?? <span className="rv-none">never</span>}
                  </td>
                  <td className="rv-mono rv-nowrap">{row.createdLabel}</td>
                  <td>
                    <ActiveToggle
                      id={row.id}
                      label={row.label}
                      active={row.active}
                      onChanged={(next) => setFlipped((prev) => ({ ...prev, [row.id]: next }))}
                    />
                  </td>
                  <td>
                    <Link className="ibtn" href={`/tracked-links/${row.id}`} aria-label="Open">
                      <IconArrowRight size={15} stroke={1.7} className="nudge" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
