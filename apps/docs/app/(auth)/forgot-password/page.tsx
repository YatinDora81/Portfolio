"use client";

import { useState } from "react";
import Link from "next/link";
import { forgotPassword } from "@/lib/actions/auth";
import { IconLayoutDashboard } from "@tabler/icons-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    const formData = new FormData();
    formData.set("email", email);
    const result = await forgotPassword(formData);
    setPending(false);
    if (result?.error) {
      setError(result.error);
    } else {
      setSent(true);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <div className="size-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <IconLayoutDashboard size={24} className="text-white" />
          </div>
        </div>

        <div className="bg-card border border-border/60 rounded-2xl p-8 shadow-xl shadow-black/[0.03]">
          <h1 className="text-2xl font-bold text-center tracking-tight mb-1">Forgot Password</h1>
          <p className="text-muted-foreground text-sm text-center mb-8">
            Enter your email and we&apos;ll send you a reset link
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/15 text-destructive text-sm">
              {error}
            </div>
          )}

          {sent ? (
            <div className="text-center space-y-4">
              <div className="p-3 rounded-xl bg-success/10 border border-success/15 text-success text-sm">
                If an account with that email exists, a reset link has been sent. Check your inbox.
              </div>
              <Link href="/login" className="text-sm text-primary/80 hover:text-primary transition-colors">
                Back to login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5 text-foreground/80">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all duration-150 placeholder:text-muted-foreground/50"
                  placeholder="admin@example.com"
                />
              </div>
              <button
                type="submit"
                disabled={pending}
                className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/25 hover:brightness-110 active:brightness-95 transition-all duration-150 disabled:opacity-50 cursor-pointer"
              >
                {pending ? "Sending..." : "Send Reset Link"}
              </button>
              <div className="text-center">
                <Link href="/login" className="text-sm text-primary/80 hover:text-primary transition-colors">
                  Back to login
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
