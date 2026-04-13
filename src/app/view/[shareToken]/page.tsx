'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Shield, Lock, Mail, ArrowRight, CheckCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';

interface ShareLinkInfo {
  id: string;
  name: string;
  roomName: string;
  organizationName: string;
  organizationLogo: string | null;
  brandColor: string | null;
  requiresPassword: boolean;
  requiresEmail: boolean;
  ndaRequired: boolean;
  ndaText: string | null;
  expiresAt: string | null;
  isActive: boolean;
}

export default function ViewerAccessPage() {
  const params = useParams();
  const router = useRouter();
  const shareToken = params['shareToken'] as string;

  const [linkInfo, setLinkInfo] = React.useState<ShareLinkInfo | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [accessGranted, setAccessGranted] = React.useState(false);

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [ndaAccepted, setNdaAccepted] = React.useState(false);

  const fetchLinkInfo = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/view/${shareToken}/info`);
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Invalid or expired link');
        setIsLoading(false);
        return;
      }

      setLinkInfo(data.link);

      // If no gates required, redirect directly to documents
      if (!data.link.requiresPassword && !data.link.requiresEmail && !data.link.ndaRequired) {
        router.push(`/view/${shareToken}/documents`);
        return;
      }
    } catch {
      setError('Failed to load link information');
    } finally {
      setIsLoading(false);
    }
  }, [shareToken, router]);

  React.useEffect(() => {
    fetchLinkInfo();
  }, [fetchLinkInfo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/view/${shareToken}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: linkInfo?.requiresEmail ? email : undefined,
          password: linkInfo?.requiresPassword ? password : undefined,
          ndaAccepted: linkInfo?.ndaRequired ? ndaAccepted : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Access denied');
      }

      setAccessGranted(true);
      setTimeout(() => {
        router.push(`/view/${shareToken}/documents`);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Access denied');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-neutral-950">
        <Card className="w-full max-w-md rounded-xl border border-neutral-200 bg-white shadow-md dark:border-neutral-700 dark:bg-neutral-900">
          <CardContent className="p-8">
            <Skeleton className="mx-auto mb-4 h-12 w-12 rounded-full" />
            <Skeleton className="mx-auto mb-2 h-6 w-48" />
            <Skeleton className="mx-auto h-4 w-64" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !linkInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-neutral-950">
        <Card className="w-full max-w-md rounded-xl border border-neutral-200 bg-white shadow-md dark:border-neutral-700 dark:bg-neutral-900">
          <CardContent className="p-8 text-center">
            <div className="dark:bg-danger-950/30 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-100">
              <Shield className="h-6 w-6 text-danger-600" />
            </div>
            <h1 className="mb-2 text-xl font-bold text-slate-950 dark:text-white">Access Denied</h1>
            <p className="text-slate-500 dark:text-slate-400">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (accessGranted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-neutral-950">
        <Card className="w-full max-w-md rounded-xl border border-neutral-200 bg-white shadow-md dark:border-neutral-700 dark:bg-neutral-900">
          <CardContent className="p-8 text-center">
            <div className="dark:bg-success-950/30 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-100">
              <CheckCircle className="h-6 w-6 text-success-600" />
            </div>
            <h1 className="mb-2 text-xl font-bold text-slate-950 dark:text-white">
              Access Granted
            </h1>
            <p className="text-slate-500 dark:text-slate-400">
              Redirecting you to the data room...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-neutral-950">
      <Card className="w-full max-w-md rounded-xl border border-neutral-200 bg-white shadow-md dark:border-neutral-700 dark:bg-neutral-900">
        <CardHeader className="text-center">
          {/* Organization Logo or Default */}
          <div className="mb-4 flex justify-center">
            {linkInfo?.organizationLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={linkInfo.organizationLogo}
                alt={linkInfo.organizationName}
                className="h-12 object-contain"
              />
            ) : (
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl text-xl font-bold text-white shadow-[0_18px_36px_-24px_rgba(37,99,235,0.7)]"
                style={{ backgroundColor: linkInfo?.brandColor || '#2563eb' }}
              >
                {linkInfo?.organizationName.charAt(0) || 'V'}
              </div>
            )}
          </div>
          <CardTitle className="text-slate-950 dark:text-white">{linkInfo?.roomName}</CardTitle>
          <CardDescription className="text-slate-500 dark:text-slate-400">
            Shared by {linkInfo?.organizationName}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Required */}
            {linkInfo?.requiresEmail && (
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-11 rounded-xl border-slate-200 bg-white pl-10 shadow-sm dark:border-slate-700 dark:bg-slate-950"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Your email will be recorded for access tracking
                </p>
              </div>
            )}

            {/* Password Required */}
            {linkInfo?.requiresPassword && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-11 rounded-xl border-slate-200 bg-white pl-10 shadow-sm dark:border-slate-700 dark:bg-slate-950"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Contact the sender if you don&apos;t have the password
                </p>
              </div>
            )}

            {/* NDA Acceptance */}
            {linkInfo?.ndaRequired && (
              <div className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                <p className="text-sm font-medium text-slate-950 dark:text-white">
                  Non-Disclosure Agreement
                </p>
                <div className="max-h-32 overflow-y-auto rounded-xl border border-slate-200/80 bg-white p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                  {linkInfo.ndaText || 'You agree to keep all information confidential.'}
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="nda"
                    checked={ndaAccepted}
                    onCheckedChange={(checked) => setNdaAccepted(checked === true)}
                  />
                  <Label
                    htmlFor="nda"
                    className="text-sm leading-tight text-slate-700 dark:text-slate-200"
                  >
                    I have read and agree to the terms above
                  </Label>
                </div>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              style={linkInfo?.brandColor ? { backgroundColor: linkInfo.brandColor } : undefined}
              loading={isSubmitting}
              disabled={
                (linkInfo?.requiresEmail && !email) ||
                (linkInfo?.requiresPassword && !password) ||
                (linkInfo?.ndaRequired && !ndaAccepted)
              }
            >
              Access Data Room
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </form>

          <div className="mt-6 border-t border-slate-200/80 pt-4 text-center dark:border-slate-800">
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Protected by VaultSpace • Secure data room
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
