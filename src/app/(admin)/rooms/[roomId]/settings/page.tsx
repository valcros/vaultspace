'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';

interface RoomSettings {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  watermarkEnabled: boolean;
  watermarkTemplate: string | null;
  downloadEnabled: boolean;
  ndaRequired: boolean;
  ndaText: string | null;
  expiresAt: string | null;
}

export default function RoomSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params['roomId'] as string;

  const [room, setRoom] = React.useState<RoomSettings | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = React.useState('');

  const [formData, setFormData] = React.useState({
    name: '',
    description: '',
    watermarkEnabled: true,
    watermarkTemplate: '{viewer_email} | {timestamp}',
    downloadEnabled: false,
    ndaRequired: false,
    ndaText: '',
    defaultExpiryDays: '',
    allDocumentsConfidential: false,
  });

  const fetchRoom = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${roomId}`);
      if (response.ok) {
        const data = await response.json();
        setRoom(data.room);
        setFormData({
          name: data.room.name,
          description: data.room.description || '',
          watermarkEnabled: data.room.watermarkEnabled,
          watermarkTemplate: data.room.watermarkTemplate || '{viewer_email} | {timestamp}',
          downloadEnabled: data.room.allowDownloads,
          ndaRequired: data.room.requiresNda || false,
          ndaText: data.room.ndaContent || '',
          defaultExpiryDays: data.room.defaultExpiryDays?.toString() || '',
          allDocumentsConfidential: data.room.allDocumentsConfidential || false,
        });
      } else if (response.status === 404) {
        router.push('/rooms');
      }
    } catch (error) {
      console.error('Failed to fetch room:', error);
    } finally {
      setIsLoading(false);
    }
  }, [roomId, router]);

  React.useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch(`/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          enableWatermark: formData.watermarkEnabled,
          watermarkTemplate: formData.watermarkTemplate,
          allowDownloads: formData.downloadEnabled,
          requiresNda: formData.ndaRequired,
          ndaContent: formData.ndaText,
          defaultExpiryDays: formData.defaultExpiryDays
            ? parseInt(formData.defaultExpiryDays, 10)
            : null,
          allDocumentsConfidential: formData.allDocumentsConfidential,
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

  const handleArchive = async () => {
    try {
      await fetch(`/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: room?.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE',
        }),
      });
      fetchRoom();
    } catch (error) {
      console.error('Failed to archive room:', error);
    }
  };

  const handleDelete = async () => {
    if (deleteConfirmation !== room?.name) {
      return;
    }

    try {
      const response = await fetch(`/api/rooms/${roomId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        router.push('/rooms');
      }
    } catch (error) {
      console.error('Failed to delete room:', error);
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

  if (!room) {
    return null;
  }

  return (
    <>
      <PageHeader
        title="Room Settings"
        breadcrumbs={[
          { label: 'Rooms', href: '/rooms' },
          { label: room.name, href: `/rooms/${roomId}` },
          { label: 'Settings' },
        ]}
        actions={
          <Button
            variant="ghost"
            className="text-white hover:bg-white/20 hover:text-white"
            onClick={() => router.push(`/rooms/${roomId}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Room
          </Button>
        }
      />

      <div className="max-w-3xl">
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
            <AlertDescription>Settings saved successfully</AlertDescription>
          </Alert>
        )}

        {/* General Settings */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>General Settings</CardTitle>
            <CardDescription>Basic room information and configuration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Room Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        {/* Security Settings */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Security Settings</CardTitle>
            <CardDescription>Control access and document protection</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="watermark">Enable Watermarks</Label>
                <p className="mt-1 text-sm text-neutral-500">
                  Add viewer identification watermarks to documents
                </p>
              </div>
              <Switch
                id="watermark"
                checked={formData.watermarkEnabled}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, watermarkEnabled: checked })
                }
              />
            </div>

            {formData.watermarkEnabled && (
              <div className="space-y-2 rounded-md bg-neutral-50 p-4">
                <Label htmlFor="watermarkTemplate">Watermark Text Template</Label>
                <Input
                  id="watermarkTemplate"
                  value={formData.watermarkTemplate}
                  onChange={(e) => setFormData({ ...formData, watermarkTemplate: e.target.value })}
                  placeholder="{viewer_email} | {timestamp}"
                />
                <p className="text-xs text-neutral-400">
                  Available placeholders: {'{viewer_email}'}, {'{viewer_name}'}, {'{timestamp}'},
                  {'{date}'}, {'{viewer_ip}'}, {'{room_name}'}
                </p>
              </div>
            )}

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="download">Allow Downloads</Label>
                <p className="mt-1 text-sm text-neutral-500">
                  Let viewers download original documents
                </p>
              </div>
              <Switch
                id="download"
                checked={formData.downloadEnabled}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, downloadEnabled: checked })
                }
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="nda">Require NDA Acceptance</Label>
                <p className="mt-1 text-sm text-neutral-500">
                  Viewers must accept terms before accessing
                </p>
              </div>
              <Switch
                id="nda"
                checked={formData.ndaRequired}
                onCheckedChange={(checked) => setFormData({ ...formData, ndaRequired: checked })}
              />
            </div>

            {formData.ndaRequired && (
              <div className="space-y-2 border-l-2 border-neutral-200 pl-4">
                <Label htmlFor="ndaText">NDA Text</Label>
                <Textarea
                  id="ndaText"
                  value={formData.ndaText}
                  onChange={(e) => setFormData({ ...formData, ndaText: e.target.value })}
                  rows={4}
                  placeholder="Enter the NDA terms that viewers must accept..."
                />
              </div>
            )}

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="confidential">All Documents Confidential</Label>
                <p className="mt-1 text-sm text-neutral-500">
                  Hide document thumbnails in grid view for all documents
                </p>
              </div>
              <Switch
                id="confidential"
                checked={formData.allDocumentsConfidential}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, allDocumentsConfidential: checked })
                }
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="defaultExpiry">Default Link Expiry (days)</Label>
              <Input
                id="defaultExpiry"
                type="number"
                min="0"
                placeholder="No default expiry"
                value={formData.defaultExpiryDays}
                onChange={(e) => setFormData({ ...formData, defaultExpiryDays: e.target.value })}
              />
              <p className="text-xs text-neutral-500">
                Set to 0 or leave blank for no default expiry on share links
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="mb-8 flex justify-end">
          <Button onClick={handleSave} loading={isSaving}>
            <Save className="mr-2 h-4 w-4" />
            Save Changes
          </Button>
        </div>

        {/* Maintenance */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Maintenance</CardTitle>
            <CardDescription>Document processing and optimization</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Regenerate Previews</p>
                <p className="text-sm text-neutral-500">
                  Re-generate thumbnails for documents missing preview images
                </p>
              </div>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/rooms/${roomId}/regenerate-previews`, {
                      method: 'POST',
                    });
                    const data = await res.json();
                    if (res.ok) {
                      setSuccess(true);
                      setError(null);
                      setTimeout(() => setSuccess(false), 3000);
                    } else {
                      setError(data.error || 'Failed to regenerate');
                    }
                  } catch {
                    setError('Failed to regenerate previews');
                  }
                }}
              >
                Regenerate
              </Button>
            </div>
            <Separator className="my-4" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Remove Orphaned Documents</p>
                <p className="text-sm text-neutral-500">
                  Delete seed/demo documents that have no actual files in storage
                </p>
              </div>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/rooms/${roomId}/cleanup-seed`, {
                      method: 'POST',
                    });
                    const data = await res.json();
                    if (res.ok) {
                      setSuccess(true);
                      setError(null);
                      setTimeout(() => setSuccess(false), 3000);
                    } else {
                      setError(data.error || 'Failed to cleanup');
                    }
                  } catch {
                    setError('Failed to cleanup documents');
                  }
                }}
              >
                Cleanup
              </Button>
            </div>
          </CardContent>
        </Card>

        <Separator className="my-6" />

        {/* Danger Zone */}
        <Card className="border-danger-200">
          <CardHeader>
            <CardTitle className="text-danger-600">Danger Zone</CardTitle>
            <CardDescription>Irreversible actions. Proceed with caution.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {room.status === 'ACTIVE' ? 'Archive Room' : 'Unarchive Room'}
                </p>
                <p className="mt-1 text-sm text-neutral-500">
                  {room.status === 'ACTIVE'
                    ? 'Archived rooms are hidden from viewers but can be restored'
                    : 'Restore this room to make it visible to viewers'}
                </p>
              </div>
              <Button variant="outline" onClick={handleArchive}>
                {room.status === 'ACTIVE' ? 'Archive' : 'Unarchive'}
              </Button>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-danger-600">Delete Room</p>
                <p className="mt-1 text-sm text-neutral-500">
                  Permanently delete this room and all its contents. This cannot be undone.
                </p>
              </div>
              <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Room</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete the room and all its
              documents, links, and activity history.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="confirmDelete">
              Type <span className="font-mono font-bold">{room.name}</span> to confirm
            </Label>
            <Input
              id="confirmDelete"
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              className="mt-2"
              placeholder={room.name}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteConfirmation !== room.name}
            >
              Delete Room
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
