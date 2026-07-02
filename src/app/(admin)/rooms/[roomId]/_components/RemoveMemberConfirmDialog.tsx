'use client';

import * as React from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export interface RemoveMemberConfirmDialogProps {
  open: boolean;
  firstName: string | undefined;
  lastName: string | undefined;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
}

export function RemoveMemberConfirmDialog({
  open,
  firstName,
  lastName,
  onCancel,
  onConfirm,
  loading,
}: RemoveMemberConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
      title="Remove Room Admin"
      description={`Are you sure you want to remove ${firstName} ${lastName} as a room admin? They will lose access to manage this room.`}
      confirmLabel="Remove"
      variant="destructive"
      onConfirm={onConfirm}
      loading={loading}
    />
  );
}
