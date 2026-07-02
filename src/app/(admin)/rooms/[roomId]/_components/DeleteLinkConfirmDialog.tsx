'use client';

import * as React from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export interface DeleteLinkConfirmDialogProps {
  open: boolean;
  linkName: string | null | undefined;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
}

export function DeleteLinkConfirmDialog({
  open,
  linkName,
  onCancel,
  onConfirm,
  loading,
}: DeleteLinkConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
      title="Delete Share Link"
      description={`Are you sure you want to delete the link "${linkName}"? External users will no longer be able to access this room via this link.`}
      confirmLabel="Delete"
      variant="destructive"
      onConfirm={onConfirm}
      loading={loading}
    />
  );
}
