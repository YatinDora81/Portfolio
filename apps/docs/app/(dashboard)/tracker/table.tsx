"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";

interface TrackerRow {
  id: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  messageId: string | null;
  path: string | null;
  referrer: string | null;
  userAgent: string | null;
  visitedAt: string;
}

function short(v: string | null, n = 42) {
  if (!v) return "—";
  return v.length > n ? `${v.slice(0, n)}…` : v;
}

function decodeUrlSafeBase64(value: string | null): string | null {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const decoded = atob(normalized + padding);
    return decoded || null;
  } catch {
    return null;
  }
}

export function TrackerTable({ rows }: { rows: TrackerRow[] }) {
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<
    "date_newest" | "date_oldest" | "source_az" | "medium_az" | "campaign_az"
  >("date_newest");
  const [decodeContent, setDecodeContent] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [mediumFilter, setMediumFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");

  const sourceOptions = useMemo(() => {
    const values = Array.from(new Set(rows.map((r) => r.source).filter(Boolean) as string[])).sort((a, b) =>
      a.localeCompare(b),
    );
    return [{ value: "all", label: "All Sources" }, ...values.map((v) => ({ value: v, label: v }))];
  }, [rows]);

  const mediumOptions = useMemo(() => {
    const values = Array.from(new Set(rows.map((r) => r.medium).filter(Boolean) as string[])).sort((a, b) =>
      a.localeCompare(b),
    );
    return [{ value: "all", label: "All Mediums" }, ...values.map((v) => ({ value: v, label: v }))];
  }, [rows]);

  const campaignOptions = useMemo(() => {
    const values = Array.from(new Set(rows.map((r) => r.campaign).filter(Boolean) as string[])).sort((a, b) =>
      a.localeCompare(b),
    );
    return [{ value: "all", label: "All Campaigns" }, ...values.map((v) => ({ value: v, label: v }))];
  }, [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const byFilters = rows.filter((r) => {
      if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
      if (mediumFilter !== "all" && r.medium !== mediumFilter) return false;
      if (campaignFilter !== "all" && r.campaign !== campaignFilter) return false;
      return true;
    });

    const searched = !s
      ? byFilters
      : byFilters.filter((r) =>
          [
            r.source,
            r.medium,
            r.campaign,
            r.content,
            decodeUrlSafeBase64(r.content),
            r.term,
            r.messageId,
            r.path,
            r.referrer,
            r.userAgent,
          ]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(s)),
        );

    const sorted = [...searched].sort((a, b) => {
      const at = new Date(a.visitedAt).getTime();
      const bt = new Date(b.visitedAt).getTime();
      if (sortBy === "date_newest") return bt - at;
      if (sortBy === "date_oldest") return at - bt;
      if (sortBy === "source_az") return (a.source || "").localeCompare(b.source || "");
      if (sortBy === "medium_az") return (a.medium || "").localeCompare(b.medium || "");
      return (a.campaign || "").localeCompare(b.campaign || "");
    });

    return sorted;
  }, [q, rows, sortBy, sourceFilter, mediumFilter, campaignFilter]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex-1">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search source, medium, campaign, content, path, message id…"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-44">
              <Select
                options={[
                  { value: "date_newest", label: "Date: Newest" },
                  { value: "date_oldest", label: "Date: Oldest" },
                  { value: "source_az", label: "Source: A-Z" },
                  { value: "medium_az", label: "Medium: A-Z" },
                  { value: "campaign_az", label: "Campaign: A-Z" },
                ]}
                value={sortBy}
                onChange={(e) =>
                  setSortBy(
                    e.target.value as
                      | "date_newest"
                      | "date_oldest"
                      | "source_az"
                      | "medium_az"
                      | "campaign_az",
                  )
                }
                className="h-10 py-0 leading-none"
              />
            </div>
            <div className="w-44">
              <Select
                options={sourceOptions}
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="h-10 py-0 leading-none"
              />
            </div>
            <div className="w-44">
              <Select
                options={mediumOptions}
                value={mediumFilter}
                onChange={(e) => setMediumFilter(e.target.value)}
                className="h-10 py-0 leading-none"
              />
            </div>
            <div className="w-44">
              <Select
                options={campaignOptions}
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value)}
                className="h-10 py-0 leading-none"
              />
            </div>
            <Switch
              checked={decodeContent}
              onChange={setDecodeContent}
              label="Decode content"
            />
            <Badge variant="outline">{filtered.length} rows</Badge>
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 border-b border-border">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold">Visited</th>
                <th className="px-3 py-2 font-semibold">Source</th>
                <th className="px-3 py-2 font-semibold">Medium</th>
                <th className="px-3 py-2 font-semibold">Campaign</th>
                <th className="px-3 py-2 font-semibold">Content</th>
                <th className="px-3 py-2 font-semibold">Term</th>
                <th className="px-3 py-2 font-semibold">Message ID</th>
                <th className="px-3 py-2 font-semibold">Path</th>
                <th className="px-3 py-2 font-semibold">Referrer</th>
                <th className="px-3 py-2 font-semibold">User Agent</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-border/60 align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(r.visitedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{r.source || "—"}</td>
                  <td className="px-3 py-2">{r.medium || "—"}</td>
                  <td className="px-3 py-2">{r.campaign || "—"}</td>
                  <td
                    className="px-3 py-2 font-mono text-xs"
                    title={decodeContent ? decodeUrlSafeBase64(r.content) || r.content || "" : r.content || ""}
                  >
                    {decodeContent
                      ? short(decodeUrlSafeBase64(r.content) || r.content, 36)
                      : short(r.content, 36)}
                  </td>
                  <td className="px-3 py-2">{r.term || "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs" title={r.messageId || ""}>
                    {short(r.messageId, 24)}
                  </td>
                  <td className="px-3 py-2" title={r.path || ""}>
                    {short(r.path, 28)}
                  </td>
                  <td className="px-3 py-2" title={r.referrer || ""}>
                    {short(r.referrer, 36)}
                  </td>
                  <td className="px-3 py-2" title={r.userAgent || ""}>
                    {short(r.userAgent, 42)}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                    No UTM tracker rows found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
