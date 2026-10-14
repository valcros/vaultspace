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
      title="Revoke Share Link"
      description={`Revoke the link "${linkName}"? External users will no longer be able to access this room through it.`}
      confirmLabel="Revoke"
      variant="destructive"
      onConfirm={onConfirm}
      loading={loading}
    />
  );
}
