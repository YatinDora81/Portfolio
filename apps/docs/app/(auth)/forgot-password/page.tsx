"use client";

import { useState } from "react";
import Link from "next/link";
import { forgotPassword } from "@/lib/actions/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  IconAlertTriangle,
  IconCat,
  IconCircleCheck,
  IconClock,
} from "@tabler/icons-react";

const SITE_HOST = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in")
  .replace(/\/$/, "")
  .replace(/^https?:\/\//, "");

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
    <div className="login">
      <div className="lg-card">
        <div className="lg-mark">
          <IconCat size={22} />
        </div>

        <h1 className="lg-h">Forgot password</h1>
        <p className="lg-s">
          We&apos;ll email a reset link for your admin account on <b>{SITE_HOST}</b>
        </p>

        {error && (
          <div className="lg-err">
            <IconAlertTriangle size={14} style={{ flex: "none" }} />
            <span>{error}</span>
          </div>
        )}

        {sent ? (
          <>
            <div
              className="lg-err"
              style={{ color: "var(--goodT)", background: "var(--good-soft)" }}
            >
              <IconCircleCheck size={14} style={{ flex: "none" }} />
              <span>
                If an account with that email exists, a reset link has been sent. Check your inbox.
              </span>
            </div>
            <div style={{ textAlign: "center", marginTop: 4 }}>
              <Link href="/login" className="lg-link">
                Back to login
              </Link>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <Input
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              autoComplete="email"
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={pending}
              className="w-full justify-center cursor-pointer"
            >
              {pending ? "Sending..." : "Send Reset Link"}
            </Button>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <Link href="/login" className="lg-link">
                Back to login
              </Link>
            </div>
          </form>
        )}

        <div className="lg-foot">
          <IconClock size={12} style={{ flex: "none" }} />
          <span>Reset links expire 15 minutes after they are issued.</span>
        </div>
      </div>
    </div>
  );
}
