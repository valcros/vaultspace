'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Building2, Upload } from 'lucide-react';
import Image from 'next/image';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';

interface OrganizationSettings {
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  faviconUrl: string | null;
}

export default function OrganizationSettingsPage() {
  const router = useRouter();
  const logoInputRef = React.useRef<HTMLInputElement>(null);
  const [settings, setSettings] = React.useState<OrganizationSettings>({
    name: '',
    slug: '',
    logoUrl: null,
    primaryColor: null,
    faviconUrl: null,
  });
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  React.useEffect(() => {
    fetchSettings();
  }, []);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, SVG, JPG)');
      return;
    }

    // Validate file size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo must be under 2MB');
      return;
    }

    setIsUploadingLogo(true);
    setError(null);
    try {
      // Convert to data URL for storage (simple approach for MVP)
      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target?.result as string;
        setSettings((prev) => ({ ...prev, logoUrl: dataUrl }));
        setIsUploadingLogo(false);
      };
      reader.onerror = () => {
        setError('Failed to read logo file');
        setIsUploadingLogo(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setError('Failed to upload logo');
      setIsUploadingLogo(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/organization/branding');
      if (response.ok) {
        const data = await response.json();
        setSettings({
          name: data.branding.name || '',
          slug: data.branding.slug || '',
          logoUrl: data.branding.logoUrl || null,
          primaryColor: data.branding.primaryColor || '#2563eb',
          faviconUrl: data.branding.faviconUrl || null,
        });
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch('/api/organization/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: settings.name,
          logoUrl: settings.logoUrl,
          primaryColor: settings.primaryColor,
          faviconUrl: settings.faviconUrl,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save settings');
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSaving(false);
    }
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
        title="Organization Settings"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Organization' }]}
        actions={
          <Button variant="outline" onClick={() => router.push('/settings')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Settings
          </Button>
        }
      />

      <div className="max-w-3xl p-6">
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
            <AlertDescription>Organization settings saved successfully</AlertDescription>
          </Alert>
        )}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Organization Profile</CardTitle>
            <CardDescription>Basic information about your organization</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Logo */}
            <div className="space-y-2">
              <Label>Logo</Label>
              <div className="flex items-center gap-4">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border bg-neutral-100">
                  {settings.logoUrl ? (
                    <Image
                      src={settings.logoUrl}
                      alt="Organization logo"
                      width={80}
                      height={80}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <Building2 className="h-8 w-8 text-neutral-400" />
                  )}
                </div>
                <div>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/svg+xml,image/jpeg"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => logoInputRef.current?.click()}
                    loading={isUploadingLogo}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Logo
                  </Button>
                  <p className="mt-2 text-xs text-neutral-500">
                    Recommended: 200x200px, PNG or SVG
                  </p>
                </div>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Organization Name</Label>
              <Input
                id="name"
                value={settings.name}
                onChange={(e) => setSettings({ ...settings, name: e.target.value })}
              />
            </div>

            {/* Slug (read-only) */}
            <div className="space-y-2">
              <Label htmlFor="slug">URL Slug</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-neutral-500">vaultspace.com/</span>
                <Input id="slug" value={settings.slug} disabled className="flex-1 bg-neutral-50" />
              </div>
              <p className="text-xs text-neutral-500">URL slug cannot be changed after creation</p>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Branding</CardTitle>
            <CardDescription>Customize the appearance of your data rooms</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Primary Color */}
            <div className="space-y-2">
              <Label htmlFor="primaryColor">Primary Color</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="primaryColor"
                  type="color"
                  value={settings.primaryColor || '#2563eb'}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                  className="h-10 w-12 cursor-pointer p-1"
                />
                <Input
                  value={settings.primaryColor || '#2563eb'}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                  placeholder="#2563eb"
                  className="w-32"
                />
                <span className="text-sm text-neutral-500">
                  Used for buttons, links, and accents
                </span>
              </div>
            </div>

            {/* Favicon URL */}
            <div className="space-y-2">
              <Label htmlFor="faviconUrl">Favicon URL</Label>
              <Input
                id="faviconUrl"
                type="url"
                value={settings.faviconUrl || ''}
                onChange={(e) => setSettings({ ...settings, faviconUrl: e.target.value })}
                placeholder="https://example.com/favicon.ico"
              />
              <p className="text-xs text-neutral-500">Custom favicon for your data room portal</p>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} loading={isSaving}>
            <Save className="mr-2 h-4 w-4" />
            Save Changes
          </Button>
        </div>
      </div>
    </>
  );
}
