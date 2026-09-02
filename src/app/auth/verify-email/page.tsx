'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

// 'ready' shows a confirmation button and does NOT consume the token. Token
// consumption happens only on an explicit click (see handleConfirm). This blocks
// passive mail-security link scanners (Safe Links, Proofpoint, Mimecast) that
// fetch and render the page but do not click application buttons, which would
// otherwise auto-verify and create an organization with no human present.
type VerifyStatus = 'ready' | 'verifying' | 'verified' | 'already' | 'error';

function VerifyEmailInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = React.useState<VerifyStatus>(token ? 'ready' : 'error');
  const [error, setError] = React.useState<string | null>(
    token ? null : 'This verification link is missing its token.'
  );
  // Guards against a double-click issuing more than one POST.
  const submitting = React.useRef(false);

  const handleConfirm = React.useCallback(async () => {
    if (!token || submitting.current) {
      return;
    }
    submitting.current = true;
    setStatus('verifying');

    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'verified') {
        setStatus('verified');
        // The API set the session cookie. Claim the public workspace URL before
        // presenting the private starter room.
        setTimeout(() => {
          router.push('/onboarding/workspace');
          router.refresh();
        }, 1200);
      } else if (res.ok && data.status === 'already_verified') {
        setStatus('already');
      } else {
        setStatus('error');
        setError(data.error || 'This verification link is invalid or has expired.');
        submitting.current = false;
      }
    } catch {
      setStatus('error');
      setError('Something went wrong verifying your email. Please try again.');
      submitting.current = false;
    }
  }, [token, router]);

  if (status === 'ready') {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">
          Confirm your email address
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Click the button below to verify your email and finish setting up your account.
        </p>
        <button
          type="button"
          onClick={handleConfirm}
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          Confirm my email address
        </button>
      </div>
    );
  }

  if (status === 'verifying') {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Verifying your email</h1>
        <p className="mt-2 text-sm text-slate-500">One moment while we confirm your account.</p>
      </div>
    );
  }

  if (status === 'verified') {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Email verified</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your private draft data room is ready. You can add documents and invite people only when
          you&apos;re ready. Taking you there now&hellip;
        </p>
      </div>
    );
  }

  if (status === 'already') {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Already verified</h1>
        <p className="mt-2 text-sm text-slate-500">This account is already verified.</p>
        <p className="mt-6 text-sm">
          <Link href="/auth/login" className="font-medium text-primary-600 hover:text-primary-700">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="text-center">
      <h1 className="text-2xl font-bold tracking-tight text-slate-950">Verification failed</h1>
      <p className="mt-2 text-sm text-slate-500">{error}</p>
      <p className="mt-6 text-sm">
        <Link
          href="/auth/resend-verification"
          className="font-medium text-primary-600 hover:text-primary-700"
        >
          Request a new verification email
        </Link>
      </p>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <React.Suspense
      fallback={
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
        </div>
      }
    >
      <VerifyEmailInner />
    </React.Suspense>
  );
}
