'use client';

import * as React from 'react';
import { Shield, ShieldCheck, ShieldOff, Copy, Check, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageHeader } from '@/components/layout/page-header';
import { AdminPageContent, AdminToolbar } from '@/components/layout/admin-page';

type SetupStep = 'idle' | 'setup' | 'verify' | 'backup' | 'disable';

export default function SecuritySettingsPage() {
  const [twoFactorEnabled, setTwoFactorEnabled] = React.useState<boolean | null>(null);
  const [step, setStep] = React.useState<SetupStep>('idle');
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  // Setup state
  const [secret, setSecret] = React.useState('');
  const [otpauthUri, setOtpauthUri] = React.useState('');
  const [verifyCode, setVerifyCode] = React.useState('');
  const [backupCodes, setBackupCodes] = React.useState<string[]>([]);
  const [disableCode, setDisableCode] = React.useState('');
  const [copiedField, setCopiedField] = React.useState<string | null>(null);
  const sectionCardClass =
    'rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900';

  // Fetch 2FA status on mount
  React.useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/auth/me');
      if (response.ok) {
        const data = await response.json();
        setTwoFactorEnabled(data.user?.twoFactorEnabled ?? false);
      }
    } catch {
      // Fallback: assume not enabled
      setTwoFactorEnabled(false);
    }
  };

  const handleSetup = async () => {
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/2fa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start 2FA setup');
      }

      setSecret(data.secret);
      setOtpauthUri(data.otpauthUri);
      setStep('setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verifyCode }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to verify code');
      }

      setBackupCodes(data.backupCodes);
      setTwoFactorEnabled(true);
      setStep('backup');
      setSuccess('Two-factor authentication has been enabled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: disableCode }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to disable 2FA');
      }

      setTwoFactorEnabled(false);
      setStep('idle');
      setDisableCode('');
      setSuccess('Two-factor authentication has been disabled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Fallback for older browsers
    }
  };

  const resetState = () => {
    setStep('idle');
    setSecret('');
    setOtpauthUri('');
    setVerifyCode('');
    setBackupCodes([]);
    setDisableCode('');
    setError(null);
    setSuccess(null);
  };

  return (
    <>
      <PageHeader
        title="Security"
        description="Manage two-factor authentication and security settings"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Security' }]}
      />

      <AdminPageContent className="mx-auto max-w-3xl">
        <AdminToolbar
          title="Authentication safeguards"
          description="Manage two-factor authentication and recovery codes so account access stays resilient even when devices change."
        />
        <div className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert>
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          {/* 2FA Status Card */}
          <Card className={sectionCardClass}>
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div
                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
                    twoFactorEnabled
                      ? 'bg-green-50 dark:bg-green-950/30'
                      : 'bg-slate-50 dark:bg-slate-900/70'
                  }`}
                >
                  {twoFactorEnabled ? (
                    <ShieldCheck className="h-5 w-5 text-green-600" />
                  ) : (
                    <Shield className="h-5 w-5 text-neutral-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-neutral-900">Two-Factor Authentication</h3>
                  <p className="mt-1 text-sm text-neutral-500">
                    {twoFactorEnabled
                      ? 'Your account is protected with two-factor authentication.'
                      : 'Add an extra layer of security to your account by requiring a verification code in addition to your password.'}
                  </p>
                  <div className="mt-1">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        twoFactorEnabled
                          ? 'bg-green-50 text-green-700'
                          : 'bg-neutral-100 text-neutral-600'
                      }`}
                    >
                      {twoFactorEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </div>
                <div className="flex-shrink-0">
                  {step === 'idle' &&
                    (twoFactorEnabled ? (
                      <Button variant="outline" size="sm" onClick={() => setStep('disable')}>
                        <ShieldOff className="mr-2 h-4 w-4" />
                        Disable
                      </Button>
                    ) : (
                      <Button size="sm" onClick={handleSetup} loading={isLoading}>
                        <Shield className="mr-2 h-4 w-4" />
                        Enable 2FA
                      </Button>
                    ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Setup Step: Show secret and URI */}
          {step === 'setup' && (
            <Card className={sectionCardClass}>
              <CardContent className="space-y-4 p-6">
                <h3 className="font-medium text-neutral-900">Set up your authenticator app</h3>
                <p className="text-sm text-neutral-500">
                  Copy the URI below and paste it into your authenticator app (such as Google
                  Authenticator, Authy, or 1Password). Alternatively, you can enter the secret key
                  manually.
                </p>

                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>OTPAuth URI</Label>
                    <div className="flex gap-2">
                      <Input readOnly value={otpauthUri} className="font-mono text-xs" />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(otpauthUri, 'uri')}
                        className="flex-shrink-0"
                      >
                        {copiedField === 'uri' ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Secret key (manual entry)</Label>
                    <div className="flex gap-2">
                      <Input readOnly value={secret} className="font-mono tracking-wider" />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(secret, 'secret')}
                        className="flex-shrink-0"
                      >
                        {copiedField === 'secret' ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleVerify} className="space-y-4 border-t pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="verifyCode">Verification code</Label>
                    <p className="text-sm text-neutral-500">
                      Enter the 6-digit code from your authenticator app to verify setup.
                    </p>
                    <Input
                      id="verifyCode"
                      type="text"
                      placeholder="000000"
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value)}
                      maxLength={6}
                      required
                      autoComplete="one-time-code"
                      autoFocus
                      className="max-w-[200px] font-mono text-lg tracking-widest"
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button type="submit" loading={isLoading}>
                      Verify and enable
                    </Button>
                    <Button type="button" variant="outline" onClick={resetState}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Backup Codes Display */}
          {step === 'backup' && backupCodes.length > 0 && (
            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
                  <div>
                    <h3 className="font-medium text-neutral-900">Save your backup codes</h3>
                    <p className="mt-1 text-sm text-neutral-500">
                      Store these codes in a safe place. Each code can only be used once. If you
                      lose access to your authenticator app, you can use a backup code to sign in.
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/70">
                  <div className="grid grid-cols-2 gap-2">
                    {backupCodes.map((code, i) => (
                      <code
                        key={i}
                        className="rounded border border-slate-200 bg-white px-3 py-2 text-center font-mono text-sm tracking-wider dark:border-slate-700 dark:bg-slate-950"
                      >
                        {code}
                      </code>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(backupCodes.join('\n'), 'backup')}
                  >
                    {copiedField === 'backup' ? (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="mr-2 h-4 w-4" />
                        Copy all codes
                      </>
                    )}
                  </Button>
                  <Button onClick={resetState}>Done</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Disable 2FA */}
          {step === 'disable' && (
            <Card className={sectionCardClass}>
              <CardContent className="space-y-4 p-6">
                <h3 className="font-medium text-neutral-900">Disable two-factor authentication</h3>
                <p className="text-sm text-neutral-500">
                  Enter a code from your authenticator app or a backup code to confirm disabling
                  2FA.
                </p>

                <form onSubmit={handleDisable} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="disableCode">Verification code</Label>
                    <Input
                      id="disableCode"
                      type="text"
                      placeholder="Enter code"
                      value={disableCode}
                      onChange={(e) => setDisableCode(e.target.value)}
                      maxLength={8}
                      required
                      autoComplete="one-time-code"
                      autoFocus
                      className="max-w-[200px] font-mono text-lg tracking-widest"
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button type="submit" variant="destructive" loading={isLoading}>
                      Disable 2FA
                    </Button>
                    <Button type="button" variant="outline" onClick={resetState}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </AdminPageContent>
    </>
  );
}
