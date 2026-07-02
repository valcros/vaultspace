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
            <Label>Category</Label>
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
              <SelectTrigger>
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
            <Label>Tags</Label>
            <Input
              placeholder="confidential, financial, q4-2026"
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
            <p className="text-xs text-neutral-600">Separate tags with commas</p>
          </div>
          <div className="space-y-1.5">
            <Label>Expiry Date</Label>
            <Input
              type="datetime-local"
              value={doc?.expiresAt ? new Date(doc.expiresAt).toISOString().slice(0, 16) : ''}
              onChange={async (e) => {
                if (doc) {
                  const val = e.target.value ? new Date(e.target.value).toISOString() : null;
                  await fetch(`/api/rooms/${roomId}/documents/${doc.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ expiresAt: val }),
                  });
                  onRefresh();
                }
              }}
            />
            <p className="text-xs text-neutral-600">
              Document will auto-archive or delete after this date
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Expiry Action</Label>
            <Select
              value={doc?.expiryAction ?? 'ARCHIVE'}
              onValueChange={async (v) => {
                if (doc) {
                  await fetch(`/api/rooms/${roomId}/documents/${doc.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ expiryAction: v }),
                  });
                  onRefresh();
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ARCHIVE">Archive</SelectItem>
                <SelectItem value="DELETE">Delete</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
