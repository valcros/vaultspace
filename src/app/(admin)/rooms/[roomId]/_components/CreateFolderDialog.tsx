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
  StarterFolderPicker,
  type StarterFolderSelection,
} from '@/components/rooms/StarterFolderPicker';

export interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Calls the page-level create handler. Resolves true when creation succeeded. */
  onCreate: (name: string) => Promise<boolean>;
  /** Adds selected root-level starter folders. It never copies documents. */
  onApplyStarter: (selection: StarterFolderSelection) => Promise<boolean>;
  isCreating: boolean;
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  onCreate,
  onApplyStarter,
  isCreating,
}: CreateFolderDialogProps) {
  const [newFolderName, setNewFolderName] = React.useState('');
  const [mode, setMode] = React.useState<'single' | 'starter'>('single');
  const [starterSelection, setStarterSelection] = React.useState<StarterFolderSelection>({
    selectedFolderPaths: [],
  });

  React.useEffect(() => {
    setMode('single');
    if (!open) {
      setStarterSelection({ selectedFolderPaths: [] });
    }
  }, [open]);

  const handleCreateFolder = React.useCallback(async () => {
    const created = await onCreate(newFolderName);
    if (created) {
      setNewFolderName('');
    }
  }, [onCreate, newFolderName]);

  const handleApplyStarter = React.useCallback(async () => {
    const created = await onApplyStarter(starterSelection);
    if (created) {
      setStarterSelection({ selectedFolderPaths: [] });
    }
  }, [onApplyStarter, starterSelection]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'single' ? 'Create New Folder' : 'Add Starter Folders'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'single'
              ? 'Create a folder to organize documents in this data room.'
              : 'Add selected folder structure at this room’s root. This does not copy documents or share another room’s content.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex gap-2" role="tablist" aria-label="Folder creation method">
            <Button
              type="button"
              size="sm"
              variant={mode === 'single' ? 'default' : 'outline'}
              onClick={() => setMode('single')}
              aria-selected={mode === 'single'}
              role="tab"
            >
              One folder
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'starter' ? 'default' : 'outline'}
              onClick={() => setMode('starter')}
              aria-selected={mode === 'starter'}
              role="tab"
            >
              Starter structure
            </Button>
          </div>
          {mode === 'single' ? (
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
          ) : (
            <StarterFolderPicker
              idPrefix="add-starter-folders"
              value={starterSelection}
              onChange={setStarterSelection}
              disabled={isCreating}
            />
          )}
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
          <Button
            onClick={mode === 'single' ? handleCreateFolder : handleApplyStarter}
            disabled={
              isCreating ||
              (mode === 'single'
                ? !newFolderName.trim()
                : !starterSelection.templateId || starterSelection.selectedFolderPaths.length === 0)
            }
          >
            {isCreating
              ? 'Creating...'
              : mode === 'single'
                ? 'Create Folder'
                : 'Add Selected Folders'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
