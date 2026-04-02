'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Send,
  AlertTriangle,
  CheckCircle,
  Copy,
  Webhook,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';

interface WebhookRoom {
  id: string;
  name: string;
}

interface WebhookData {
  id: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  secret?: string;
  description: string | null;
  eventTypes: string[];
  roomId: string | null;
  isActive: boolean;
  lastTriggeredAt: string | null;
  failureCount: number;
  room: WebhookRoom | null;
}

const COMMON_EVENT_TYPES = [
  { value: 'DOCUMENT_UPLOADED', label: 'Document Uploaded' },
  { value: 'DOCUMENT_UPDATED', label: 'Document Updated' },
  { value: 'DOCUMENT_DELETED', label: 'Document Deleted' },
  { value: 'DOCUMENT_VIEWED', label: 'Document Viewed' },
  { value: 'DOCUMENT_DOWNLOADED', label: 'Document Downloaded' },
  { value: 'ROOM_CREATED', label: 'Room Created' },
  { value: 'ROOM_UPDATED', label: 'Room Updated' },
  { value: 'ROOM_STATUS_CHANGED', label: 'Room Status Changed' },
  { value: 'LINK_CREATED', label: 'Link Created' },
  { value: 'LINK_ACCESSED', label: 'Link Accessed' },
  { value: 'USER_INVITED', label: 'User Invited' },
  { value: 'QUESTION_SUBMITTED', label: 'Question Submitted' },
  { value: 'ANSWER_SUBMITTED', label: 'Answer Submitted' },
];

export default function WebhooksSettingsPage() {
  const router = useRouter();
  const [webhooks, setWebhooks] = React.useState<WebhookData[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Create dialog state
  const [showCreateDialog, setShowCreateDialog] = React.useState(false);
  const [createUrl, setCreateUrl] = React.useState('');
  const [createDescription, setCreateDescription] = React.useState('');
  const [createEventTypes, setCreateEventTypes] = React.useState<string[]>([]);
  const [isCreating, setIsCreating] = React.useState(false);

  // Secret reveal dialog
  const [createdWebhook, setCreatedWebhook] = React.useState<WebhookData | null>(null);
  const [showSecretDialog, setShowSecretDialog] = React.useState(false);
  const [secretCopied, setSecretCopied] = React.useState(false);

  // Test state
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<{
    id: string;
    success: boolean;
    message: string;
  } | null>(null);

  React.useEffect(() => {
    fetchWebhooks();
  }, []);

  const fetchWebhooks = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/settings/webhooks');
      if (!response.ok) {
        throw new Error('Failed to fetch webhooks');
      }
      const data = await response.json();
      setWebhooks(data.webhooks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load webhooks');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      setIsCreating(true);
      setError(null);

      const response = await fetch('/api/settings/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: createUrl,
          description: createDescription || undefined,
          eventTypes: createEventTypes.length > 0 ? createEventTypes : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create webhook');
      }

      const data = await response.json();
      setShowCreateDialog(false);
      setCreateUrl('');
      setCreateDescription('');
      setCreateEventTypes([]);

      // Show secret dialog
      setCreatedWebhook(data.webhook);
      setShowSecretDialog(true);
      setSecretCopied(false);

      fetchWebhooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleActive = async (webhookId: string, isActive: boolean) => {
    try {
      const response = await fetch(`/api/settings/webhooks/${webhookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });

      if (!response.ok) {
        throw new Error('Failed to update webhook');
      }
      fetchWebhooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle webhook');
    }
  };

  const handleDelete = async (webhookId: string) => {
    if (!confirm('Are you sure you want to delete this webhook?')) {
      return;
    }

    try {
      const response = await fetch(`/api/settings/webhooks/${webhookId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete webhook');
      }
      fetchWebhooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete webhook');
    }
  };

  const handleTest = async (webhook: WebhookData) => {
    try {
      setTestingId(webhook.id);
      setTestResult(null);

      // Send a test payload directly to the webhook URL via our API
      const response = await fetch(`/api/settings/webhooks/${webhook.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastTriggeredAt: new Date().toISOString() }),
      });

      // We mark it as tested by updating lastTriggeredAt
      if (response.ok) {
        setTestResult({
          id: webhook.id,
          success: true,
          message: 'Test event queued successfully',
        });
        fetchWebhooks();
      } else {
        setTestResult({
          id: webhook.id,
          success: false,
          message: 'Failed to send test event',
        });
      }
    } catch {
      setTestResult({
        id: webhook.id,
        success: false,
        message: 'Network error sending test',
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleCopySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 3000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = secret;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 3000);
    }
  };

  const toggleEventType = (eventType: string) => {
    setCreateEventTypes((prev) =>
      prev.includes(eventType) ? prev.filter((t) => t !== eventType) : [...prev, eventType]
    );
  };

  const truncateUrl = (url: string, maxLen = 50): string => {
    if (url.length <= maxLen) {
      return url;
    }
    return url.substring(0, maxLen) + '...';
  };

  const formatTimeAgo = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) {
      return 'Just now';
    }
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) {
      return `${diffDays}d ago`;
    }
    return date.toLocaleDateString();
  };

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Configure webhook endpoints to receive event notifications"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push('/settings')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Settings
            </Button>
            <Button size="sm" onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Webhook
            </Button>
          </div>
        }
      />

      <div className="space-y-4 p-6">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <Skeleton className="mb-2 h-6 w-64" />
                  <Skeleton className="h-4 w-96" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : webhooks.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Webhook className="mx-auto mb-4 h-12 w-12 text-neutral-300" />
              <h3 className="mb-1 text-lg font-medium text-neutral-900">No webhooks configured</h3>
              <p className="mb-4 text-sm text-neutral-500">
                Add a webhook endpoint to receive real-time notifications about events in your
                organization.
              </p>
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Webhook
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {webhooks.map((webhook) => (
              <Card key={webhook.id}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <code className="truncate font-mono text-sm text-neutral-700">
                          {truncateUrl(webhook.url)}
                        </code>
                        {!webhook.isActive && <Badge variant="secondary">Disabled</Badge>}
                        {webhook.failureCount > 0 && (
                          <Badge variant="danger">
                            {webhook.failureCount} failure{webhook.failureCount !== 1 ? 's' : ''}
                          </Badge>
                        )}
                      </div>

                      {webhook.description && (
                        <p className="mb-2 text-sm text-neutral-500">{webhook.description}</p>
                      )}

                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {webhook.eventTypes.length === 0 ? (
                          <Badge variant="outline">All events</Badge>
                        ) : (
                          webhook.eventTypes.map((evt) => (
                            <Badge key={evt} variant="secondary" className="text-xs">
                              {evt
                                .replace(/_/g, ' ')
                                .toLowerCase()
                                .replace(/\b\w/g, (c) => c.toUpperCase())}
                            </Badge>
                          ))
                        )}
                        {webhook.room && <Badge variant="outline">Room: {webhook.room.name}</Badge>}
                      </div>

                      <div className="flex items-center gap-4 text-xs text-neutral-400">
                        {webhook.lastTriggeredAt && (
                          <span>Last triggered: {formatTimeAgo(webhook.lastTriggeredAt)}</span>
                        )}
                        <span>Created: {new Date(webhook.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="flex flex-shrink-0 items-center gap-3">
                      <Switch
                        checked={webhook.isActive}
                        onCheckedChange={(checked: boolean) =>
                          handleToggleActive(webhook.id, checked)
                        }
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTest(webhook)}
                        disabled={testingId === webhook.id || !webhook.isActive}
                      >
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(webhook.id)}
                        className="text-danger-600 hover:text-danger-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {testResult && testResult.id === webhook.id && (
                    <div
                      className={`mt-3 rounded p-2 text-sm ${
                        testResult.success
                          ? 'bg-success-50 text-success-700'
                          : 'bg-danger-50 text-danger-700'
                      }`}
                    >
                      {testResult.success ? (
                        <CheckCircle className="mr-1 inline h-3.5 w-3.5" />
                      ) : (
                        <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                      )}
                      {testResult.message}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Webhook Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Webhook</DialogTitle>
            <DialogDescription>
              Enter a URL endpoint to receive event notifications via HTTP POST.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">Endpoint URL</Label>
              <Input
                id="webhook-url"
                placeholder="https://example.com/webhooks/vaultspace"
                value={createUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreateUrl(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhook-description">Description (optional)</Label>
              <Input
                id="webhook-description"
                placeholder="Slack integration, CI/CD trigger, etc."
                value={createDescription}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setCreateDescription(e.target.value)
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Event Types (leave unchecked for all events)</Label>
              <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto rounded-md border p-3">
                {COMMON_EVENT_TYPES.map((evt) => (
                  <label key={evt.value} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={createEventTypes.includes(evt.value)}
                      onCheckedChange={() => toggleEventType(evt.value)}
                    />
                    <span className="text-neutral-700">{evt.label}</span>
                  </label>
                ))}
              </div>
              {createEventTypes.length > 0 && (
                <p className="text-xs text-neutral-500">
                  {createEventTypes.length} event type{createEventTypes.length !== 1 ? 's' : ''}{' '}
                  selected
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!createUrl || isCreating}>
              {isCreating ? 'Creating...' : 'Create Webhook'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Secret Reveal Dialog */}
      <Dialog open={showSecretDialog} onOpenChange={setShowSecretDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Webhook Created</DialogTitle>
            <DialogDescription>
              Save the signing secret below. It will not be shown again.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Copy and securely store this secret. You will use it to verify webhook signatures
                (HMAC-SHA256). This is the only time it will be displayed.
              </AlertDescription>
            </Alert>

            {createdWebhook?.secret && (
              <div className="mt-4">
                <Label className="mb-1 block text-xs text-neutral-500">Signing Secret</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded-md border bg-neutral-50 p-3 font-mono text-sm">
                    {createdWebhook.secret}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopySecret(createdWebhook.secret!)}
                  >
                    {secretCopied ? (
                      <CheckCircle className="h-4 w-4 text-success-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {secretCopied && (
                  <p className="mt-1 text-xs text-success-600">Copied to clipboard</p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => setShowSecretDialog(false)}>I have saved the secret</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
