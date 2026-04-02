'use client';

import * as React from 'react';
import {
  ClipboardCheck,
  Plus,
  Check,
  Circle,
  Minus,
  Loader2,
  FileText,
  Trash2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';

/* ---------- Types ---------- */

type ItemStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'NOT_APPLICABLE';

interface ChecklistItem {
  id: string;
  name: string;
  status: ItemStatus;
  isRequired: boolean;
  assignedToEmail: string | null;
  documentId: string | null;
  documentName: string | null;
  sortOrder: number;
}

interface Checklist {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  items: ChecklistItem[];
  _count?: { items: number };
  completedCount?: number;
  totalCount?: number;
}

/* ---------- Helpers ---------- */

function getProgress(checklist: Checklist) {
  const items = checklist.items ?? [];
  const total = checklist.totalCount ?? items.length;
  const completed = checklist.completedCount ?? items.filter((i) => i.status === 'COMPLETE').length;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { completed, total, pct };
}

function itemStatusBadge(status: ItemStatus) {
  switch (status) {
    case 'PENDING':
      return (
        <Badge variant="outline" className="border-neutral-300 bg-neutral-50 text-neutral-500">
          <Circle className="mr-1 h-3 w-3" />
          Pending
        </Badge>
      );
    case 'IN_PROGRESS':
      return (
        <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700">
          <Loader2 className="mr-1 h-3 w-3" />
          In Progress
        </Badge>
      );
    case 'COMPLETE':
      return (
        <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">
          <Check className="mr-1 h-3 w-3" />
          Complete
        </Badge>
      );
    case 'NOT_APPLICABLE':
      return (
        <Badge
          variant="outline"
          className="border-neutral-300 bg-neutral-50 italic text-neutral-400"
        >
          <Minus className="mr-1 h-3 w-3" />
          N/A
        </Badge>
      );
  }
}

/* ---------- Component ---------- */

export function ChecklistTab({ roomId }: { roomId: string }) {
  const [checklists, setChecklists] = React.useState<Checklist[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  // New checklist dialog
  const [showNewDialog, setShowNewDialog] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newDescription, setNewDescription] = React.useState('');
  const [newIsPublic, setNewIsPublic] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Inline new‑item form
  const [addingItemChecklistId, setAddingItemChecklistId] = React.useState<string | null>(null);
  const [newItemName, setNewItemName] = React.useState('');
  const [isSubmittingItem, setIsSubmittingItem] = React.useState(false);

  /* ---- Fetch ---- */

  const fetchChecklists = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/checklists`);
      if (!res.ok) {
        throw new Error('Failed to fetch checklists');
      }
      const data = await res.json();
      setChecklists(data.checklists ?? data);
    } catch {
      toast({ title: 'Error', description: 'Failed to load checklists', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [roomId]);

  React.useEffect(() => {
    fetchChecklists();
  }, [fetchChecklists]);

  /* ---- Create checklist ---- */

  const handleCreateChecklist = async () => {
    if (!newName.trim()) {
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/checklists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || null,
          isPublic: newIsPublic,
        }),
      });
      if (!res.ok) {
        throw new Error('Failed to create checklist');
      }
      toast({ title: 'Checklist created' });
      setShowNewDialog(false);
      setNewName('');
      setNewDescription('');
      setNewIsPublic(false);
      fetchChecklists();
    } catch {
      toast({ title: 'Error', description: 'Failed to create checklist', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ---- Toggle item status (PENDING ↔ COMPLETE) ---- */

  const handleToggleItem = async (checklistId: string, item: ChecklistItem) => {
    const nextStatus: ItemStatus = item.status === 'COMPLETE' ? 'PENDING' : 'COMPLETE';
    try {
      const res = await fetch(`/api/rooms/${roomId}/checklists/${checklistId}/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        throw new Error('Failed to update item');
      }
      const updated = await res.json();
      setChecklists((prev) =>
        prev.map((cl) =>
          cl.id === checklistId
            ? {
                ...cl,
                items: cl.items.map((i) => (i.id === item.id ? { ...i, ...updated } : i)),
              }
            : cl
        )
      );
    } catch {
      toast({ title: 'Error', description: 'Failed to update item', variant: 'destructive' });
    }
  };

  /* ---- Add item ---- */

  const handleAddItem = async (checklistId: string) => {
    if (!newItemName.trim()) {
      return;
    }
    setIsSubmittingItem(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/checklists/${checklistId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newItemName.trim() }),
      });
      if (!res.ok) {
        throw new Error('Failed to add item');
      }
      const item = await res.json();
      setChecklists((prev) =>
        prev.map((cl) => (cl.id === checklistId ? { ...cl, items: [...cl.items, item] } : cl))
      );
      setNewItemName('');
      setAddingItemChecklistId(null);
    } catch {
      toast({ title: 'Error', description: 'Failed to add item', variant: 'destructive' });
    } finally {
      setIsSubmittingItem(false);
    }
  };

  /* ---- Delete item ---- */

  const handleDeleteItem = async (checklistId: string, itemId: string) => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/checklists/${checklistId}/items/${itemId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('Failed to delete item');
      }
      setChecklists((prev) =>
        prev.map((cl) =>
          cl.id === checklistId ? { ...cl, items: cl.items.filter((i) => i.id !== itemId) } : cl
        )
      );
    } catch {
      toast({ title: 'Error', description: 'Failed to delete item', variant: 'destructive' });
    }
  };

  /* ---- Expand / collapse ---- */

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
    setAddingItemChecklistId(null);
    setNewItemName('');
  };

  /* ---- Render ---- */

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Checklists</h3>
        <Button onClick={() => setShowNewDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Checklist
        </Button>
      </div>

      {/* Checklist list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : checklists.length === 0 ? (
        <Card className="p-8 text-center">
          <ClipboardCheck className="mx-auto mb-3 h-10 w-10 text-neutral-400" />
          <h3 className="mb-1 text-base font-semibold text-neutral-900">No checklists yet</h3>
          <p className="mx-auto max-w-sm text-sm text-neutral-500">
            Create a checklist to track due‑diligence items in this room.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {checklists.map((cl) => {
            const { completed, total, pct } = getProgress(cl);
            const isExpanded = expandedId === cl.id;

            return (
              <Card key={cl.id} className="overflow-hidden">
                {/* Card header – always visible */}
                <button
                  type="button"
                  className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-neutral-50"
                  onClick={() => toggleExpand(cl.id)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-neutral-500" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-neutral-500" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-neutral-900">{cl.name}</span>
                      {cl.isPublic && (
                        <Badge
                          variant="outline"
                          className="border-blue-200 bg-blue-50 text-xs text-blue-600"
                        >
                          Public
                        </Badge>
                      )}
                    </div>
                    {cl.description && (
                      <p className="mt-0.5 truncate text-sm text-neutral-500">{cl.description}</p>
                    )}
                  </div>

                  {/* Progress */}
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-neutral-500">
                      {completed}/{total} ({pct}%)
                    </span>
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-neutral-200">
                      <div
                        className="h-full rounded-full bg-green-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </button>

                {/* Expanded items */}
                {isExpanded && (
                  <div className="border-t px-4 pb-4 pt-2">
                    {cl.items.length === 0 ? (
                      <p className="py-3 text-center text-sm text-neutral-400">No items yet.</p>
                    ) : (
                      <ul className="divide-y">
                        {cl.items.map((item) => (
                          <li key={item.id} className="flex items-center gap-3 py-2">
                            {/* Toggle checkbox */}
                            <button
                              type="button"
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                                item.status === 'COMPLETE'
                                  ? 'border-green-500 bg-green-500 text-white'
                                  : 'border-neutral-300 hover:border-neutral-400'
                              }`}
                              onClick={() => handleToggleItem(cl.id, item)}
                              aria-label={`Toggle ${item.name}`}
                            >
                              {item.status === 'COMPLETE' && <Check className="h-3 w-3" />}
                            </button>

                            {/* Item name */}
                            <span
                              className={`min-w-0 flex-1 text-sm ${
                                item.status === 'COMPLETE'
                                  ? 'text-neutral-400 line-through'
                                  : 'text-neutral-900'
                              }`}
                            >
                              {item.name}
                            </span>

                            {/* Badges / metadata */}
                            <div className="flex shrink-0 items-center gap-2">
                              {item.isRequired && (
                                <span className="text-xs font-medium text-red-500">Required</span>
                              )}
                              {itemStatusBadge(item.status)}
                              {item.documentName && (
                                <span className="flex items-center gap-1 text-xs text-blue-600">
                                  <FileText className="h-3 w-3" />
                                  {item.documentName}
                                </span>
                              )}
                              {item.assignedToEmail && (
                                <span className="text-xs text-neutral-500">
                                  {item.assignedToEmail}
                                </span>
                              )}
                              <button
                                type="button"
                                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-500"
                                onClick={() => handleDeleteItem(cl.id, item.id)}
                                aria-label={`Delete ${item.name}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Add item */}
                    {addingItemChecklistId === cl.id ? (
                      <div className="mt-2 flex items-center gap-2">
                        <Input
                          placeholder="Item name"
                          value={newItemName}
                          onChange={(e) => setNewItemName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleAddItem(cl.id);
                            }
                          }}
                          autoFocus
                          className="h-8 text-sm"
                        />
                        <Button
                          size="sm"
                          onClick={() => handleAddItem(cl.id)}
                          disabled={!newItemName.trim() || isSubmittingItem}
                        >
                          {isSubmittingItem ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setAddingItemChecklistId(null);
                            setNewItemName('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2 text-neutral-500"
                        onClick={() => {
                          setAddingItemChecklistId(cl.id);
                          setNewItemName('');
                        }}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Add Item
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* New Checklist Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Checklist</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cl-name">Name</Label>
              <Input
                id="cl-name"
                placeholder="Checklist name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cl-desc">Description</Label>
              <textarea
                id="cl-desc"
                className="w-full rounded-md border border-neutral-300 p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                rows={3}
                placeholder="Optional description..."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newIsPublic}
                onChange={(e) => setNewIsPublic(e.target.checked)}
                className="rounded border-neutral-300"
              />
              Public checklist
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateChecklist} disabled={!newName.trim() || isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Checklist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
