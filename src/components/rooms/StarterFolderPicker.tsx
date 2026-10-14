'use client';

import * as React from 'react';

import { CheckSquare, FolderTree, Loader2, Plus, Square, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MAX_INITIAL_ROOM_FOLDERS,
  resolveAdditionalRoomFolders,
  type AdditionalRoomFolder,
} from '@/lib/rooms/additionalRoomFolders';
import { MAX_FOLDER_DEPTH } from '@/lib/rooms/folderDepth';

export interface StarterFolder {
  name: string;
  path: string;
}

export interface StarterFolderTemplate {
  id: string;
  name: string;
  description: string | null;
  category?: string;
  revision: string;
  structure?: { folders?: StarterFolder[] };
  folderStructure?: { folders?: StarterFolder[] };
}

export interface StarterFolderSelection {
  templateId?: string;
  templateRevision?: string;
  selectedFolderPaths: string[];
  additionalFolders?: AdditionalRoomFolder[];
}

function foldersFor(template: StarterFolderTemplate): StarterFolder[] {
  return template.structure?.folders ?? template.folderStructure?.folders ?? [];
}

function parentPath(path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : null;
}

function depth(path: string): number {
  return path.split('/').filter(Boolean).length;
}

function retainAdditions(
  additions: AdditionalRoomFolder[],
  selectedTemplatePaths: Set<string>
): AdditionalRoomFolder[] {
  const available = new Set(selectedTemplatePaths);
  const retained: AdditionalRoomFolder[] = [];
  for (const addition of additions) {
    if (addition.parentPath === null || available.has(addition.parentPath)) {
      retained.push(addition);
      available.add(`${addition.parentPath ?? ''}/${addition.name}`);
    }
  }
  return retained;
}

interface StarterFolderPickerProps {
  value: StarterFolderSelection;
  onChange: (value: StarterFolderSelection) => void;
  disabled?: boolean;
  idPrefix: string;
  allowAdditionalFolders?: boolean;
}

/**
 * A structure-only picker for independent rooms. Selecting a template does
 * not copy documents or link this room to any other room.
 */
export function StarterFolderPicker({
  value,
  onChange,
  disabled = false,
  idPrefix,
  allowAdditionalFolders = false,
}: StarterFolderPickerProps) {
  const [templates, setTemplates] = React.useState<StarterFolderTemplate[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [newFolderName, setNewFolderName] = React.useState('');
  const [newFolderParent, setNewFolderParent] = React.useState('');
  const [folderError, setFolderError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    async function loadTemplates() {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch('/api/rooms/templates', {
          credentials: 'include',
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load starter structures');
        }
        setTemplates(data.templates || []);
      } catch (cause) {
        if ((cause as Error).name !== 'AbortError') {
          setError('Starter structures could not be loaded. You can still create an empty room.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }
    void loadTemplates();
    return () => controller.abort();
  }, []);

  const selectedTemplate = templates.find((template) => template.id === value.templateId);
  const selectedPaths = new Set(value.selectedFolderPaths);
  const selectedCount = selectedTemplate
    ? foldersFor(selectedTemplate).filter((folder) => selectedPaths.has(folder.path)).length
    : 0;
  const templateFolders = selectedTemplate
    ? foldersFor(selectedTemplate).filter((folder) => selectedPaths.has(folder.path))
    : [];
  const additionalFolders = value.additionalFolders ?? [];
  const combined = resolveAdditionalRoomFolders(templateFolders, additionalFolders);
  const previewFolders = combined.ok
    ? combined.folders
    : [
        ...templateFolders,
        ...additionalFolders.map((folder) => ({
          name: folder.name,
          path: `${folder.parentPath ?? ''}/${folder.name}`,
        })),
      ];
  const parentOptions = previewFolders.filter((folder) => depth(folder.path) < MAX_FOLDER_DEPTH);
  const validNewFolderParent = parentOptions.some((folder) => folder.path === newFolderParent)
    ? newFolderParent
    : '';

  const addFolder = () => {
    const addition = { name: newFolderName.trim(), parentPath: validNewFolderParent || null };
    const next = resolveAdditionalRoomFolders(templateFolders, [...additionalFolders, addition]);
    if (!next.ok) {
      setFolderError(next.error);
      return;
    }
    onChange({ ...value, additionalFolders: [...additionalFolders, addition] });
    setNewFolderName('');
    setFolderError(null);
  };

  const removeFolder = (path: string) => {
    const remaining = additionalFolders.filter((folder) => {
      const folderPath = `${folder.parentPath ?? ''}/${folder.name}`;
      return folderPath !== path && !folderPath.startsWith(`${path}/`);
    });
    onChange({ ...value, additionalFolders: remaining });
    setNewFolderParent('');
    setFolderError(null);
  };

  const chooseTemplate = (template?: StarterFolderTemplate) => {
    if (template?.id === value.templateId) {
      return;
    }
    onChange({
      templateId: template?.id,
      templateRevision: template?.revision,
      selectedFolderPaths: template ? foldersFor(template).map((folder) => folder.path) : [],
      additionalFolders: [],
    });
    setNewFolderParent('');
    setFolderError(null);
  };

  const updatePath = (folder: StarterFolder, checked: boolean) => {
    if (!selectedTemplate) {
      return;
    }
    const next = new Set(selectedPaths);
    if (!checked) {
      for (const candidate of foldersFor(selectedTemplate)) {
        if (candidate.path === folder.path || candidate.path.startsWith(`${folder.path}/`)) {
          next.delete(candidate.path);
        }
      }
    } else {
      next.add(folder.path);
      let ancestor = parentPath(folder.path);
      while (ancestor) {
        next.add(ancestor);
        ancestor = parentPath(ancestor);
      }
    }
    const retained = retainAdditions(additionalFolders, next);
    const prospectiveFolders = foldersFor(selectedTemplate).filter((candidate) =>
      next.has(candidate.path)
    );
    const checkedTree = resolveAdditionalRoomFolders(prospectiveFolders, retained);
    if (!checkedTree.ok) {
      setFolderError(checkedTree.error);
      return;
    }
    onChange({
      templateId: selectedTemplate.id,
      templateRevision: selectedTemplate.revision,
      selectedFolderPaths: [...next],
      additionalFolders: retained,
    });
    setNewFolderParent('');
    setFolderError(null);
  };

  return (
    <section className="space-y-3" aria-labelledby={`${idPrefix}-starter-heading`}>
      <div className="flex items-start gap-2">
        <FolderTree className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
        <div>
          <h3 id={`${idPrefix}-starter-heading`} className="text-sm font-medium text-neutral-900">
            Standard folder templates{' '}
            <span className="font-normal text-neutral-500">(optional)</span>
          </h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            {allowAdditionalFolders
              ? 'Choose a template and review its folder checklist, then add any folders specific to this room. No documents or permissions are copied. Changing templates clears custom folders.'
              : 'Choose a template and review its folder checklist. No documents or permissions are copied.'}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-3 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading starter structures
        </div>
      ) : (
        <div
          className="grid gap-2 sm:grid-cols-2"
          role="radiogroup"
          aria-label="Starter folder structure"
        >
          <button
            type="button"
            role="radio"
            aria-checked={!selectedTemplate}
            disabled={disabled}
            onClick={() => chooseTemplate()}
            className={`rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60 ${
              !selectedTemplate
                ? 'border-primary-500 bg-primary-50 text-primary-900'
                : 'border-neutral-200 hover:border-neutral-300'
            }`}
          >
            <span className="font-medium">Start empty</span>
            <span className="mt-1 block text-xs text-neutral-500">
              Add folders one at a time later.
            </span>
          </button>
          {templates.map((template) => {
            const isSelected = selectedTemplate?.id === template.id;
            return (
              <button
                key={template.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={disabled}
                onClick={() => chooseTemplate(template)}
                className={`rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60 ${
                  isSelected
                    ? 'border-primary-500 bg-primary-50 text-primary-900'
                    : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <span className="font-medium">{template.name}</span>
                <span className="mt-1 block text-xs text-neutral-500">{template.description}</span>
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <p className="text-xs text-amber-700" role="status">
          {error}
        </p>
      )}

      {selectedTemplate && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-neutral-900" aria-live="polite">
              {selectedCount} of {foldersFor(selectedTemplate).length} folders selected
            </p>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  const all = foldersFor(selectedTemplate);
                  const checkedTree = resolveAdditionalRoomFolders(all, additionalFolders);
                  if (!checkedTree.ok) {
                    setFolderError(checkedTree.error);
                    return;
                  }
                  onChange({
                    templateId: selectedTemplate.id,
                    templateRevision: selectedTemplate.revision,
                    selectedFolderPaths: all.map((folder) => folder.path),
                    additionalFolders,
                  });
                  setFolderError(null);
                }}
              >
                <CheckSquare className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Select all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || selectedCount === 0}
                onClick={() => {
                  onChange({
                    templateId: selectedTemplate.id,
                    templateRevision: selectedTemplate.revision,
                    selectedFolderPaths: [],
                    additionalFolders: retainAdditions(additionalFolders, new Set()),
                  });
                  setNewFolderParent('');
                  setFolderError(null);
                }}
              >
                <Square className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Clear all
              </Button>
            </div>
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
            {foldersFor(selectedTemplate).map((folder) => {
              const checked = selectedPaths.has(folder.path);
              const checkboxId = `${idPrefix}-${folder.path.replace(/[^a-z0-9]+/gi, '-')}`;
              return (
                <label
                  key={folder.path}
                  htmlFor={checkboxId}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-white"
                  style={{ marginLeft: `${(depth(folder.path) - 1) * 16}px` }}
                >
                  <Checkbox
                    id={checkboxId}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(nextChecked) => updatePath(folder, nextChecked === true)}
                  />
                  <span>{folder.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
      {allowAdditionalFolders && (
        <div className="space-y-3 rounded-lg border border-neutral-200 p-3">
          <div>
            <h4 className="text-sm font-medium text-neutral-900">Folders for this room</h4>
            <p className="mt-0.5 text-xs text-neutral-500">
              Add empty folders at the top level or inside a selected folder. These additions belong
              only to this room.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-custom-name`}>Folder name</Label>
              <Input
                id={`${idPrefix}-custom-name`}
                value={newFolderName}
                maxLength={255}
                disabled={disabled || previewFolders.length >= MAX_INITIAL_ROOM_FOLDERS}
                aria-invalid={!!folderError}
                aria-describedby={folderError ? `${idPrefix}-custom-error` : undefined}
                onChange={(event) => {
                  setNewFolderName(event.target.value);
                  setFolderError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addFolder();
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-custom-parent`}>Inside</Label>
              <select
                id={`${idPrefix}-custom-parent`}
                value={validNewFolderParent}
                disabled={disabled || previewFolders.length >= MAX_INITIAL_ROOM_FOLDERS}
                onChange={(event) => setNewFolderParent(event.target.value)}
                className="flex h-10 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60"
              >
                <option value="">Top level</option>
                {parentOptions.map((folder) => (
                  <option key={folder.path} value={folder.path}>
                    {folder.name} ({folder.path})
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || previewFolders.length >= MAX_INITIAL_ROOM_FOLDERS}
              onClick={addFolder}
            >
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add folder
            </Button>
          </div>
          {folderError && (
            <p id={`${idPrefix}-custom-error`} role="alert" className="text-xs text-red-700">
              {folderError}
            </p>
          )}
          {!combined.ok && (
            <p role="alert" className="text-xs text-red-700">
              {combined.error}
            </p>
          )}
          <div aria-live="polite" className="rounded-md bg-neutral-50 p-2">
            <p className="text-xs font-medium text-neutral-700">
              Preview: {previewFolders.length} folders ({selectedCount} from template,{' '}
              {additionalFolders.length} for this room)
            </p>
            {previewFolders.length === 0 ? (
              <p className="mt-1 text-xs text-neutral-500">The room will start without folders.</p>
            ) : (
              <ul
                className="mt-2 max-h-40 space-y-1 overflow-y-auto"
                aria-label="Folder tree preview"
              >
                {[...previewFolders]
                  .sort((a, b) => a.path.localeCompare(b.path))
                  .map((folder) => {
                    const isAdditional = additionalFolders.some(
                      (addition) => `${addition.parentPath ?? ''}/${addition.name}` === folder.path
                    );
                    return (
                      <li
                        key={folder.path}
                        className="flex items-center justify-between gap-2 text-xs text-neutral-800"
                        style={{ paddingLeft: `${(depth(folder.path) - 1) * 16}px` }}
                      >
                        <span className="min-w-0 truncate">
                          {folder.name}
                          {isAdditional ? ' (room-specific)' : ''}
                        </span>
                        {isAdditional && (
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => removeFolder(folder.path)}
                            aria-label={`Remove ${folder.name} and its subfolders`}
                            className="shrink-0 rounded p-1 text-neutral-500 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
