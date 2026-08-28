"use client";

import { useState } from "react";
import Link from "next/link";
import { login, sendLoginOtp, verifyLoginOtp } from "@/lib/actions/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  IconAlertTriangle,
  IconCat,
  IconEye,
  IconEyeOff,
  IconMail,
  IconShieldCheck,
} from "@tabler/icons-react";

const SITE_HOST = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in")
  .replace(/\/$/, "")
  .replace(/^https?:\/\//, "");

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
  const [showPassword, setShowPassword] = useState(false);

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
    <div className="login">
      <div className="lg-card">
        <div className="lg-mark">
          <IconCat size={22} />
        </div>

        <h1 className="lg-h">{mode === "password" ? "Welcome back" : "OTP Verification"}</h1>
        <p className="lg-s">
          {mode === "password" ? (
            <>Sign in to the control room for <b>{SITE_HOST}</b></>
          ) : mode === "otp-send" ? (
            <>Send a one-time code to continue to <b>{SITE_HOST}</b></>
          ) : (
            <>Enter the 6-digit code sent to <b>{email}</b></>
          )}
        </p>

        {info && (
          <div className="lg-err" style={{ color: "var(--accT)", background: "var(--accS)" }}>
            <IconMail size={14} style={{ flex: "none" }} />
            <span>{info}</span>
          </div>
        )}

        {error && (
          <div className="lg-err">
            <IconAlertTriangle size={14} style={{ flex: "none" }} />
            <span>{error}</span>
          </div>
        )}

        {mode === "password" && (
          <form onSubmit={handlePasswordSubmit}>
            <Input
              label="Username or Email"
              type="text"
              name="identifier"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="username or email"
              autoComplete="username"
            />
            <div style={{ position: "relative" }}>
              <Input
                label="Password"
                type={showPassword ? "text" : "password"}
                name="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                className="ibtn cursor-pointer"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                style={{ position: "absolute", right: 6, bottom: 5 }}
              >
                {showPassword ? <IconEyeOff size={15} /> : <IconEye size={15} />}
              </button>
            </div>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={pending}
              className="w-full justify-center cursor-pointer"
            >
              {pending ? "Signing in..." : "Sign in"}
            </Button>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <Link href="/forgot-password" className="lg-link">
                Forgot password?
              </Link>
            </div>
          </form>
        )}

        {mode === "otp-send" && (
          <form onSubmit={handleSendOtp}>
            <Input
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              readOnly={!!email}
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={pending}
              className="w-full justify-center cursor-pointer"
            >
              {pending ? "Sending OTP..." : "Send OTP"}
            </Button>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <button
                type="button"
                onClick={() => { setMode("password"); setError(""); setInfo(""); }}
                className="lg-link"
              >
                Back to password login
              </button>
            </div>
          </form>
        )}

        {mode === "otp-verify" && (
          <form onSubmit={handleVerifyOtp}>
            <Input
              label="OTP Code"
              type="text"
              mono
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
              style={{ textAlign: "center", letterSpacing: "0.34em", fontSize: 15 }}
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={pending || otp.length !== 6}
              className="w-full justify-center cursor-pointer"
            >
              {pending ? "Verifying..." : "Verify & Sign in"}
            </Button>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 14,
              }}
            >
              <button
                type="button"
                onClick={() => { setMode("otp-send"); setOtp(""); setError(""); setInfo(""); }}
                className="lg-link"
              >
                Resend OTP
              </button>
              <button
                type="button"
                onClick={() => { setMode("password"); setOtp(""); setError(""); setInfo(""); }}
                className="lg-link"
              >
                Back to login
              </button>
            </div>
          </form>
        )}

        <div className="lg-foot">
          <IconShieldCheck size={12} style={{ flex: "none" }} />
          <span>Admin access only. Three failed attempts lock the account and switch sign-in to email OTP.</span>
        </div>
      </div>
    </div>
  );
}
