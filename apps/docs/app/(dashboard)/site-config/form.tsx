"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { updateSiteConfig } from "@/lib/actions/site-config";

interface ConfigEntry { key: string; label: string; description: string; value: string }

export function SiteConfigForm({ configs }: { configs: ConfigEntry[] }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(configs.map(c => [c.key, c.value]))
  );
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    startTransition(async () => {
      await updateSiteConfig(Object.entries(values).map(([key, value]) => ({ key, value })));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <Card>
      <div className="space-y-4">
        {configs.map((c) => (
          <div key={c.key}>
            <label className="block text-sm font-medium mb-1">{c.label}</label>
            <p className="text-xs text-muted-foreground mb-1.5">{c.description}</p>
            <input
              value={values[c.key] || ""}
              onChange={(e) => setValues(prev => ({ ...prev, [c.key]: e.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end mt-6 gap-2">
        {saved && <span className="text-sm text-success self-center">Saved!</span>}
        <Button onClick={handleSave} disabled={pending}>
          {pending ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </Card>
  );
}
