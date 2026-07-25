"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { resetPassword } from "@/lib/actions/auth";
import { Suspense } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  IconAlertTriangle,
  IconCat,
  IconCircleCheck,
  IconEye,
  IconEyeOff,
  IconKey,
} from "@tabler/icons-react";

const SITE_HOST = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.yatindora.in")
  .replace(/\/$/, "")
  .replace(/^https?:\/\//, "");

function ResetForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
      <>
        <div className="lg-err">
          <IconAlertTriangle size={14} style={{ flex: "none" }} />
          <span>Invalid reset link. Please request a new one.</span>
        </div>
        <div style={{ textAlign: "center", marginTop: 4 }}>
          <Link href="/forgot-password" className="lg-link">
            Request new link
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      {error && (
        <div className="lg-err">
          <IconAlertTriangle size={14} style={{ flex: "none" }} />
          <span>{error}</span>
        </div>
      )}

      {success ? (
        <>
          <div
            className="lg-err"
            style={{ color: "var(--goodT)", background: "var(--good-soft)" }}
          >
            <IconCircleCheck size={14} style={{ flex: "none" }} />
            <span>Password reset successfully!</span>
          </div>
          <Link href="/login" className="btn pri w-full justify-center cursor-pointer">
            Sign in
          </Link>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={{ position: "relative" }}>
            <Input
              label="New Password"
              type={showPassword ? "text" : "password"}
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              minLength={6}
              autoComplete="new-password"
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
          <Input
            label="Confirm Password"
            type={showPassword ? "text" : "password"}
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            minLength={6}
            autoComplete="new-password"
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={pending}
            className="w-full justify-center cursor-pointer"
          >
            {pending ? "Resetting..." : "Reset Password"}
          </Button>
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <Link href="/login" className="lg-link">
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
    <div className="login">
      <div className="lg-card">
        <div className="lg-mark">
          <IconCat size={22} />
        </div>

        <h1 className="lg-h">Reset password</h1>
        <p className="lg-s">
          Choose a new password for your admin account on <b>{SITE_HOST}</b>
        </p>

        <Suspense
          fallback={
            <div className="hint" style={{ marginBottom: 14 }}>
              Loading...
            </div>
          }
        >
          <ResetForm />
        </Suspense>

        <div className="lg-foot">
          <IconKey size={12} style={{ flex: "none" }} />
          <span>Minimum 6 characters. Resetting clears any account lock and pending OTP.</span>
        </div>
      </div>
    </div>
  );
}
