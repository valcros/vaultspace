'use client';

import * as React from 'react';

import { CheckSquare, FolderTree, Loader2, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export interface StarterFolder {
  name: string;
  path: string;
}

export interface StarterFolderTemplate {
  id: string;
  name: string;
  description: string | null;
  category?: string;
  structure?: { folders?: StarterFolder[] };
  folderStructure?: { folders?: StarterFolder[] };
}

export interface StarterFolderSelection {
  templateId?: string;
  selectedFolderPaths: string[];
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

interface StarterFolderPickerProps {
  value: StarterFolderSelection;
  onChange: (value: StarterFolderSelection) => void;
  disabled?: boolean;
  idPrefix: string;
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
}: StarterFolderPickerProps) {
  const [templates, setTemplates] = React.useState<StarterFolderTemplate[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

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

  const chooseTemplate = (template?: StarterFolderTemplate) => {
    onChange({
      templateId: template?.id,
      selectedFolderPaths: template ? foldersFor(template).map((folder) => folder.path) : [],
    });
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
    onChange({ templateId: selectedTemplate.id, selectedFolderPaths: [...next] });
  };

  return (
    <section className="space-y-3" aria-labelledby={`${idPrefix}-starter-heading`}>
      <div className="flex items-start gap-2">
        <FolderTree className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
        <div>
          <h3 id={`${idPrefix}-starter-heading`} className="text-sm font-medium text-neutral-900">
            Starter folders <span className="font-normal text-neutral-500">(optional)</span>
          </h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            Choose only the folders this independent room needs. This creates folder structure only,
            not shared documents or access to another room.
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
                onClick={() =>
                  onChange({
                    templateId: selectedTemplate.id,
                    selectedFolderPaths: foldersFor(selectedTemplate).map((folder) => folder.path),
                  })
                }
              >
                <CheckSquare className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Select all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || selectedCount === 0}
                onClick={() =>
                  onChange({ templateId: selectedTemplate.id, selectedFolderPaths: [] })
                }
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
    </section>
  );
}
