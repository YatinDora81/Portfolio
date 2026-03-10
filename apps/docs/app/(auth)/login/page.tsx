"use client";

import { useState } from "react";
import Link from "next/link";
import { login, sendLoginOtp, verifyLoginOtp } from "@/lib/actions/auth";
import { IconLayoutDashboard } from "@tabler/icons-react";

type Mode = "password" | "otp-send" | "otp-verify";

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<Mode>("password");

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setPending(true);
    const formData = new FormData();
    formData.set("identifier", identifier);
    formData.set("password", password);
    const result = await login(formData);
    setPending(false);
    if (result?.locked) {
      setEmail(result.email || "");
      setMode("otp-send");
      setError("");
      setInfo("Account locked after 3 failed attempts. Please verify via OTP sent to your email.");
    } else if (result?.error) {
      setError(result.error);
    }
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setPending(true);
    const formData = new FormData();
    formData.set("email", email);
    const result = await sendLoginOtp(formData);
    setPending(false);
    if (result?.error) {
      setError(result.error);
    } else {
      setMode("otp-verify");
      setInfo("OTP sent to your email. It expires in 5 minutes.");
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setPending(true);
    const formData = new FormData();
    formData.set("email", email);
    formData.set("otp", otp);
    const result = await verifyLoginOtp(formData);
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
          <h1 className="text-2xl font-bold text-center tracking-tight mb-1">
            {mode === "password" ? "Welcome back" : "OTP Verification"}
          </h1>
          <p className="text-muted-foreground text-sm text-center mb-8">
            {mode === "password"
              ? "Sign in to manage your portfolio"
              : mode === "otp-send"
                ? "Send OTP to your email to continue"
                : "Enter the OTP sent to your email"}
          </p>

          {info && (
            <div className="mb-4 p-3 rounded-xl bg-blue-500/10 border border-blue-500/15 text-blue-400 text-sm">
              {info}
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/15 text-destructive text-sm">
              {error}
            </div>
          )}

          {/* Password Login Form */}
          {mode === "password" && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
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
          )}

          {/* OTP Send Form */}
          {mode === "otp-send" && (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5 text-foreground/80">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all duration-150 placeholder:text-muted-foreground/50"
                  placeholder="admin@example.com"
                  readOnly={!!email}
                />
              </div>
              <button
                type="submit"
                disabled={pending}
                className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/25 hover:brightness-110 active:brightness-95 transition-all duration-150 disabled:opacity-50 cursor-pointer"
              >
                {pending ? "Sending OTP..." : "Send OTP"}
              </button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => { setMode("password"); setError(""); setInfo(""); }}
                  className="text-sm text-primary/80 hover:text-primary transition-colors cursor-pointer"
                >
                  Back to password login
                </button>
              </div>
            </form>
          )}

          {/* OTP Verify Form */}
          {mode === "otp-verify" && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5 text-foreground/80">OTP Code</label>
                <input
                  type="text"
                  required
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-center tracking-[0.3em] font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all duration-150 placeholder:text-muted-foreground/50 placeholder:tracking-normal"
                  placeholder="Enter 6-digit OTP"
                  maxLength={6}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
              </div>
              <button
                type="submit"
                disabled={pending || otp.length !== 6}
                className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/25 hover:brightness-110 active:brightness-95 transition-all duration-150 disabled:opacity-50 cursor-pointer"
              >
                {pending ? "Verifying..." : "Verify & Sign in"}
              </button>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => { setMode("otp-send"); setOtp(""); setError(""); setInfo(""); }}
                  className="text-sm text-primary/80 hover:text-primary transition-colors cursor-pointer"
                >
                  Resend OTP
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("password"); setOtp(""); setError(""); setInfo(""); }}
                  className="text-sm text-primary/80 hover:text-primary transition-colors cursor-pointer"
                >
                  Back to login
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
