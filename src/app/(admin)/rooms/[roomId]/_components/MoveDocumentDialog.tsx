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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** The subset of the room page's Document shape this dialog reads. */
export interface MoveDocument {
  id: string;
  name: string;
  folderId?: string | null;
}

interface FolderOption {
  id: string;
  name: string;
  path: string;
}

export interface MoveDocumentDialogProps {
  /** Document being moved; the dialog is open whenever this is non-null. */
  doc: MoveDocument | null;
  roomId: string;
  onClose: () => void;
  /** Refreshes the page's document list after a successful move. */
  onMoved: () => void;
}

// Sentinel for "no folder" (room root); Select needs a non-empty string value.
const ROOT_VALUE = '__root__';

export function MoveDocumentDialog({ doc, roomId, onClose, onMoved }: MoveDocumentDialogProps) {
  const [folders, setFolders] = React.useState<FolderOption[]>([]);
  const [target, setTarget] = React.useState<string>(ROOT_VALUE);
  const [loading, setLoading] = React.useState(false);
  const [moving, setMoving] = React.useState(false);

  // Seed the target from the document each time the dialog opens.
  const [prevDoc, setPrevDoc] = React.useState<MoveDocument | null>(null);
  if (doc !== prevDoc) {
    setPrevDoc(doc);
    setTarget(doc?.folderId ?? ROOT_VALUE);
  }

  React.useEffect(() => {
    if (!doc) {
      return;
    }
    let active = true;
    setLoading(true);
    fetch(`/api/rooms/${roomId}/folders`)
      .then((r) => (r.ok ? r.json() : { folders: [] }))
      .then((data) => {
        if (active) {
          setFolders(data.folders || []);
        }
      })
      .catch(() => {
        // Leave the list empty on failure.
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [doc, roomId]);

  const targetFolderId = target === ROOT_VALUE ? null : target;
  const unchanged = (doc?.folderId ?? null) === targetFolderId;

  const handleMove = async () => {
    if (!doc) {
      return;
    }
    setMoving(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: targetFolderId }),
      });
      if (res.ok) {
        onMoved();
        onClose();
      }
    } finally {
      setMoving(false);
    }
  };

  return (
    <Dialog
      open={doc !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move document</DialogTitle>
          <DialogDescription>
            Move &quot;{doc?.name}&quot; to another folder. Its accession number does not change.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label>Destination folder</Label>
          <Select value={target} onValueChange={setTarget} disabled={loading}>
            <SelectTrigger>
              <SelectValue placeholder="Select a folder" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ROOT_VALUE}>Root (no folder)</SelectItem>
              {folders.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.path || f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={moving}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={moving || unchanged}>
            {moving ? 'Moving…' : 'Move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
