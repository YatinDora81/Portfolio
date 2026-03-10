"use client";

import { useState } from "react";
import Link from "next/link";
import { login } from "@/lib/actions/auth";
import { IconLayoutDashboard } from "@tabler/icons-react";

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    const formData = new FormData();
    formData.set("identifier", identifier);
    formData.set("password", password);
    const result = await login(formData);
    setPending(false);
    if (result?.error) {
      setError(result.error);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="size-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <IconLayoutDashboard size={24} className="text-white" />
          </div>
        </div>

        <div className="bg-card border border-border/60 rounded-2xl p-8 shadow-xl shadow-black/[0.03]">
          <h1 className="text-2xl font-bold text-center tracking-tight mb-1">Welcome back</h1>
          <p className="text-muted-foreground text-sm text-center mb-8">Sign in to manage your portfolio</p>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/15 text-destructive text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5 text-foreground/80">Username or Email</label>
              <input
                type="text"
                name="identifier"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all duration-150 placeholder:text-muted-foreground/50"
                placeholder="username or email"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-foreground/80">Password</label>
                <Link href="/forgot-password" className="text-xs text-primary/80 hover:text-primary transition-colors">
                  Forgot password?
                </Link>
              </div>
              <input
                type="password"
                name="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all duration-150 placeholder:text-muted-foreground/50"
                placeholder="Enter your password"
              />
            </div>
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/25 hover:brightness-110 active:brightness-95 transition-all duration-150 disabled:opacity-50 cursor-pointer"
            >
              {pending ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
