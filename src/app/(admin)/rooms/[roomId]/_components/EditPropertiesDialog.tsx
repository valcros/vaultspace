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
import { CATEGORY_OPTIONS } from '@/lib/documentCategories';

/** The subset of the room page's Document shape this dialog reads. */
export interface EditPropertiesDocument {
  id: string;
  name: string;
  tags: string[];
  category: string | null;
  expiresAt: string | null;
  expiryAction: string | null;
}

export interface EditPropertiesDialogProps {
  /** Document being edited; the dialog is open whenever this is non-null. */
  doc: EditPropertiesDocument | null;
  roomId: string;
  onClose: () => void;
  /** Refreshes the page's document list (fetchDocuments). */
  onRefresh: () => void;
  /** Calls the page-level tag save handler for the current doc. */
  onSaveTags: (tags: string[]) => void;
}

export function EditPropertiesDialog({
  doc,
  roomId,
  onClose,
  onRefresh,
  onSaveTags,
}: EditPropertiesDialogProps) {
  const [tagInput, setTagInput] = React.useState('');

  // Re-seed the tag input from the document each time the dialog opens
  // (doc transitions null -> document), matching the old page-level
  // setTagInput calls at every open site. State-from-props during render
  // avoids a one-frame flash of the previous value.
  const [prevDoc, setPrevDoc] = React.useState<EditPropertiesDocument | null>(null);
  if (doc !== prevDoc) {
    setPrevDoc(doc);
    if (doc) {
      setTagInput((doc.tags || []).join(', '));
    }
  }

  return (
    <Dialog
      open={!!doc}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Properties</DialogTitle>
          <DialogDescription>
            Update tags and category for &quot;{doc?.name}&quot;.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="documentCategory">Category</Label>
            <Select
              value={doc?.category ?? 'none'}
              onValueChange={async (v) => {
                if (doc) {
                  await fetch(`/api/rooms/${roomId}/documents/${doc.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ category: v === 'none' ? null : v }),
                  });
                  onRefresh();
                }
              }}
            >
              <SelectTrigger id="documentCategory">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No category</SelectItem>
                {CATEGORY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="documentTags">Tags</Label>
            <Input
              id="documentTags"
              placeholder="confidential, financial, q4-2026"
              aria-describedby="documentTagsHelp"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && doc) {
                  const tags = tagInput
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean);
                  onSaveTags(tags);
                }
              }}
            />
            <p id="documentTagsHelp" className="text-xs text-neutral-600">
              Separate tags with commas
            </p>
          </div>
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Automatic document expiry is unavailable. Existing expiry dates are retained but do not
            archive or delete documents.
            {doc?.expiresAt && (
              <span className="mt-1 block">
                Date on file: {new Date(doc.expiresAt).toLocaleDateString()}.
                {doc.expiryAction ? ` Action on file: ${doc.expiryAction.toLowerCase()}.` : ''}
              </span>
            )}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (doc) {
                const tags = tagInput
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean);
                onSaveTags(tags);
              }
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
