'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Building2, CheckCircle2, FolderOpen, Globe2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface SetupData {
  onboardingRequired: boolean;
  organization: { name: string; suggestedSlug: string } | null;
  starterRoom: { id: string; name: string } | null;
}

export default function WorkspaceSetupPage() {
  const router = useRouter();
  const [setup, setSetup] = React.useState<SetupData | null>(null);
  const [organizationName, setOrganizationName] = React.useState('');
  const [workspaceSlug, setWorkspaceSlug] = React.useState('');
  const [roomName, setRoomName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      const response = await fetch('/api/onboarding/workspace', { cache: 'no-store' });
      if (!response.ok) {
        setError('Unable to load workspace setup. Please refresh and try again.');
        return;
      }
      const data = (await response.json()) as SetupData;
      setSetup(data);
      if (!data.onboardingRequired || !data.organization || !data.starterRoom) {
        router.replace('/rooms');
        return;
      }
      setOrganizationName(data.organization.name);
      setWorkspaceSlug(data.organization.suggestedSlug);
      setRoomName(data.starterRoom.name);
    })();
  }, [router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const response = await fetch('/api/onboarding/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationName, workspaceSlug, roomName }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to set up workspace.');
      }
      router.replace(`/rooms/${data.room.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to set up workspace.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!setup && !error) {
    return <div className="p-6 text-sm text-slate-500">Loading workspace setup…</div>;
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-2xl items-center px-4 py-10">
      <Card className="w-full border-slate-200 shadow-sm">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary-50 text-primary-700">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <CardTitle>Set up your workspace</CardTitle>
          <CardDescription>
            Choose your company URL and personalize your first private draft data room. Your
            workspace URL is permanent once claimed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {setup?.onboardingRequired && (
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="organizationName">
                  <Building2 className="mr-1 inline h-4 w-4" aria-hidden="true" />
                  Organization name
                </Label>
                <Input
                  id="organizationName"
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  required
                  maxLength={255}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="workspaceSlug">
                  <Globe2 className="mr-1 inline h-4 w-4" aria-hidden="true" />
                  Workspace URL
                </Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-500">https://</span>
                  <Input
                    id="workspaceSlug"
                    value={workspaceSlug}
                    onChange={(event) => setWorkspaceSlug(event.target.value.toLowerCase())}
                    required
                    minLength={3}
                    maxLength={63}
                    pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <span className="whitespace-nowrap text-sm text-slate-500">.vaultspace.org</span>
                </div>
                <p className="text-xs text-slate-500">
                  Use lowercase letters, numbers, and hyphens. This URL cannot be changed later.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="roomName">
                  <FolderOpen className="mr-1 inline h-4 w-4" aria-hidden="true" />
                  First data room
                </Label>
                <Input
                  id="roomName"
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                  required
                  maxLength={255}
                />
                <p className="text-xs text-slate-500">
                  Your room remains a private draft until you choose to share it.
                </p>
              </div>
              <Button type="submit" className="w-full" loading={isSaving}>
                Claim workspace URL and continue
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
