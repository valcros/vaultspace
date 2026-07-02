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

export interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Calls the page-level add handler. Resolves true when the admin was added. */
  onAdd: (email: string) => Promise<boolean>;
  isAdding: boolean;
}

export function AddMemberDialog({ open, onOpenChange, onAdd, isAdding }: AddMemberDialogProps) {
  const [newMemberEmail, setNewMemberEmail] = React.useState('');

  const handleAddMember = React.useCallback(async () => {
    const added = await onAdd(newMemberEmail);
    if (added) {
      setNewMemberEmail('');
    }
  }, [onAdd, newMemberEmail]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Room Admin</DialogTitle>
          <DialogDescription>
            Add a team member as an admin of this data room. They must have an existing account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="memberEmail">Email Address</Label>
            <Input
              id="memberEmail"
              type="email"
              placeholder="member@example.com"
              value={newMemberEmail}
              onChange={(e) => setNewMemberEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isAdding) {
                  handleAddMember();
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
              setNewMemberEmail('');
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleAddMember} disabled={isAdding || !newMemberEmail.trim()}>
            {isAdding ? 'Adding...' : 'Add Admin'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
