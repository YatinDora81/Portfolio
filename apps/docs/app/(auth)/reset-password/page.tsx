"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { resetPassword } from "@/lib/actions/auth";
import { Suspense } from "react";
import { IconLayoutDashboard } from "@tabler/icons-react";

function ResetForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    const result = await resetPassword(token, newPassword, confirmPassword);
    setPending(false);
    if (result?.error) {
      setError(result.error);
    } else {
      setSuccess(true);
    }
  }

  if (!token) {
    return (
      <div className="text-center space-y-4">
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/15 text-destructive text-sm">
          Invalid reset link. Please request a new one.
        </div>
        <Link href="/forgot-password" className="text-sm text-primary/80 hover:text-primary transition-colors">
          Request new link
        </Link>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/15 text-destructive text-sm">
          {error}
        </div>
      )}

      {success ? (
        <div className="text-center space-y-4">
          <div className="p-3 rounded-xl bg-success/10 border border-success/15 text-success text-sm">
            Password reset successfully!
          </div>
          <Link
            href="/login"
            className="block w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/25 hover:brightness-110 transition-all duration-150 text-center"
          >
            Sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5 text-foreground/80">New Password</label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all duration-150 placeholder:text-muted-foreground/50"
              placeholder="Enter new password"
              minLength={6}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5 text-foreground/80">Confirm Password</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all duration-150 placeholder:text-muted-foreground/50"
              placeholder="Confirm new password"
              minLength={6}
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/25 hover:brightness-110 active:brightness-95 transition-all duration-150 disabled:opacity-50 cursor-pointer"
          >
            {pending ? "Resetting..." : "Reset Password"}
          </button>
          <div className="text-center">
            <Link href="/login" className="text-sm text-primary/80 hover:text-primary transition-colors">
              Back to login
            </Link>
          </div>
        </form>
      )}
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <div className="size-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <IconLayoutDashboard size={24} className="text-white" />
          </div>
        </div>

        <div className="bg-card border border-border/60 rounded-2xl p-8 shadow-xl shadow-black/[0.03]">
          <h1 className="text-2xl font-bold text-center tracking-tight mb-1">Reset Password</h1>
          <p className="text-muted-foreground text-sm text-center mb-8">
            Enter your new password
          </p>
          <Suspense fallback={<div className="text-center text-sm text-muted-foreground">Loading...</div>}>
            <ResetForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
