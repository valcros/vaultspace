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

export interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Calls the page-level create handler. Resolves true when creation succeeded. */
  onCreate: (name: string) => Promise<boolean>;
  isCreating: boolean;
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  onCreate,
  isCreating,
}: CreateFolderDialogProps) {
  const [newFolderName, setNewFolderName] = React.useState('');

  const handleCreateFolder = React.useCallback(async () => {
    const created = await onCreate(newFolderName);
    if (created) {
      setNewFolderName('');
    }
  }, [onCreate, newFolderName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Folder</DialogTitle>
          <DialogDescription>
            Create a folder to organize documents in this data room.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="folderName">Folder Name</Label>
            <Input
              id="folderName"
              placeholder="Enter folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isCreating) {
                  handleCreateFolder();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setNewFolderName('');
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleCreateFolder} disabled={isCreating || !newFolderName.trim()}>
            {isCreating ? 'Creating...' : 'Create Folder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
