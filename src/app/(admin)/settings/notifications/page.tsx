'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/layout/page-header';
import { AdminPageContent, AdminToolbar } from '@/components/layout/admin-page';

interface NotificationPreferences {
  emailOnDocumentViewed: boolean;
  emailOnDocumentUploaded: boolean;
  emailOnAccessRevoked: boolean;
  emailDailyDigest: boolean;
  digestFrequency: 'IMMEDIATE' | 'DAILY' | 'WEEKLY';
}

const defaultPreferences: NotificationPreferences = {
  emailOnDocumentViewed: false,
  emailOnDocumentUploaded: true,
  emailOnAccessRevoked: true,
  emailDailyDigest: true,
  digestFrequency: 'DAILY',
};

export default function NotificationSettingsPage() {
  const router = useRouter();
  const [preferences, setPreferences] = React.useState<NotificationPreferences>(defaultPreferences);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const sectionCardClass =
    'rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900';

  React.useEffect(() => {
    fetchPreferences();
  }, []);

  const fetchPreferences = async () => {
    try {
      const response = await fetch('/api/users/me/notifications');
      if (response.ok) {
        const data = await response.json();
        setPreferences({
          emailOnDocumentViewed:
            data.preferences.emailOnDocumentViewed ?? defaultPreferences.emailOnDocumentViewed,
          emailOnDocumentUploaded:
            data.preferences.emailOnDocumentUploaded ?? defaultPreferences.emailOnDocumentUploaded,
          emailOnAccessRevoked:
            data.preferences.emailOnAccessRevoked ?? defaultPreferences.emailOnAccessRevoked,
          emailDailyDigest:
            data.preferences.emailDailyDigest ?? defaultPreferences.emailDailyDigest,
          digestFrequency: data.preferences.digestFrequency ?? defaultPreferences.digestFrequency,
        });
      }
    } catch (error) {
      console.error('Failed to fetch preferences:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch('/api/users/me/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });

      if (!response.ok) {
        throw new Error('Failed to save preferences');
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSaving(false);
    }
  };

  const updatePreference = <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K]
  ) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="mb-8 h-4 w-96" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Notification Settings"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Notifications' }]}
        actions={
          <Button variant="outline" onClick={() => router.push('/settings')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Settings
          </Button>
        }
      />

      <AdminPageContent className="max-w-4xl">
        <AdminToolbar
          title="Notification delivery"
          description="Control which events trigger emails and how frequently activity digests are delivered."
          actions={
            <Button onClick={handleSave} loading={isSaving}>
              <Save className="mr-2 h-4 w-4" />
              Save Preferences
            </Button>
          }
        />
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert
            variant="default"
            className="mb-6 border-success-200 bg-success-50 text-success-800"
          >
            <AlertDescription>Notification preferences saved successfully</AlertDescription>
          </Alert>
        )}

        {/* Email Notifications */}
        <Card className={sectionCardClass}>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-200/60 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Email Notifications</CardTitle>
                <CardDescription>Choose which events trigger email notifications</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="emailDocViewed">Document Viewed</Label>
                <p className="mt-1 text-sm text-neutral-500">
                  Get notified when someone views a document
                </p>
              </div>
              <Switch
                id="emailDocViewed"
                checked={preferences.emailOnDocumentViewed}
                onCheckedChange={(checked) => updatePreference('emailOnDocumentViewed', checked)}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="emailDocUploaded">Document Uploaded</Label>
                <p className="mt-1 text-sm text-neutral-500">
                  Get notified when new documents are uploaded
                </p>
              </div>
              <Switch
                id="emailDocUploaded"
                checked={preferences.emailOnDocumentUploaded}
                onCheckedChange={(checked) => updatePreference('emailOnDocumentUploaded', checked)}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="emailAccessRevoked">Access Revoked</Label>
                <p className="mt-1 text-sm text-neutral-500">
                  Get notified when your access to a room is revoked
                </p>
              </div>
              <Switch
                id="emailAccessRevoked"
                checked={preferences.emailOnAccessRevoked}
                onCheckedChange={(checked) => updatePreference('emailOnAccessRevoked', checked)}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="emailDailyDigest">Activity Digest</Label>
                <p className="mt-1 text-sm text-neutral-500">
                  Receive periodic summaries of room activity
                </p>
              </div>
              <Switch
                id="emailDailyDigest"
                checked={preferences.emailDailyDigest}
                onCheckedChange={(checked) => updatePreference('emailDailyDigest', checked)}
              />
            </div>

            {preferences.emailDailyDigest && (
              <div className="ml-6 pt-2">
                <Label htmlFor="digestFrequency">Digest Frequency</Label>
                <Select
                  value={preferences.digestFrequency}
                  onValueChange={(value) =>
                    updatePreference(
                      'digestFrequency',
                      value as NotificationPreferences['digestFrequency']
                    )
                  }
                >
                  <SelectTrigger className="mt-2 w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IMMEDIATE">Immediate</SelectItem>
                    <SelectItem value="DAILY">Daily</SelectItem>
                    <SelectItem value="WEEKLY">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>
      </AdminPageContent>
    </>
  );
}
