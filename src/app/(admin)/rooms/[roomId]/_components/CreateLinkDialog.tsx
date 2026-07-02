'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface CreateLinkValues {
  name: string;
  permission: 'VIEW' | 'DOWNLOAD';
  password: string;
  expiry: string;
  sessionLimit: string;
}

export interface CreateLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Calls the page-level create handler. Resolves true when the link was created. */
  onCreate: (values: CreateLinkValues) => Promise<boolean>;
  isCreating: boolean;
}

export function CreateLinkDialog({
  open,
  onOpenChange,
  onCreate,
  isCreating,
}: CreateLinkDialogProps) {
  const [newLinkName, setNewLinkName] = React.useState('');
  const [newLinkPermission, setNewLinkPermission] = React.useState<'VIEW' | 'DOWNLOAD'>('VIEW');
  const [newLinkPassword, setNewLinkPassword] = React.useState('');
  const [newLinkExpiry, setNewLinkExpiry] = React.useState('');
  const [newLinkSessionLimit, setNewLinkSessionLimit] = React.useState('');

  const handleCreateLink = React.useCallback(async () => {
    const created = await onCreate({
      name: newLinkName,
      permission: newLinkPermission,
      password: newLinkPassword,
      expiry: newLinkExpiry,
      sessionLimit: newLinkSessionLimit,
    });
    if (created) {
      setNewLinkName('');
      setNewLinkPermission('VIEW');
      setNewLinkPassword('');
      setNewLinkExpiry('');
      setNewLinkSessionLimit('');
    }
  }, [
    onCreate,
    newLinkName,
    newLinkPermission,
    newLinkPassword,
    newLinkExpiry,
    newLinkSessionLimit,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Share Link</DialogTitle>
          <DialogDescription>
            Create a link to share this room with external users.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="linkName">Link Name</Label>
            <Input
              id="linkName"
              placeholder="Investor Access"
              value={newLinkName}
              onChange={(e) => setNewLinkName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isCreating) {
                  handleCreateLink();
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="linkPermission">Permission Level</Label>
            <Select
              value={newLinkPermission}
              onValueChange={(value) => setNewLinkPermission(value as 'VIEW' | 'DOWNLOAD')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="VIEW">View Only</SelectItem>
                <SelectItem value="DOWNLOAD">View & Download</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="linkPassword">Password Protection (optional)</Label>
            <Input
              id="linkPassword"
              type="password"
              placeholder="Leave blank for no password"
              value={newLinkPassword}
              onChange={(e) => setNewLinkPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="linkExpiry">Expiration Date (optional)</Label>
            <Input
              id="linkExpiry"
              type="datetime-local"
              value={newLinkExpiry}
              onChange={(e) => setNewLinkExpiry(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="linkSessionLimit">Session Time Limit in Minutes (optional)</Label>
            <Input
              id="linkSessionLimit"
              type="number"
              min="1"
              placeholder="e.g. 60"
              value={newLinkSessionLimit}
              onChange={(e) => setNewLinkSessionLimit(e.target.value)}
            />
            <p className="text-xs text-neutral-500">
              Maximum viewing time per session. Leave blank for unlimited.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setNewLinkName('');
              setNewLinkPermission('VIEW');
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleCreateLink} disabled={isCreating || !newLinkName.trim()}>
            {isCreating ? 'Creating...' : 'Create Link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
