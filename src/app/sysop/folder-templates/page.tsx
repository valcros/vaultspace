'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { MAX_FOLDER_DEPTH } from '@/lib/rooms/folderDepth';

interface TemplateDraft {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  structure: { folders: { name: string; path: string }[] };
}
interface SystemTemplate extends TemplateDraft {
  id: string;
  revision: string;
}
const emptyDraft = (): TemplateDraft => ({
  name: '',
  description: '',
  category: '',
  enabled: true,
  structure: { folders: [{ name: '', path: '' }] },
});
const copyDraft = (template: TemplateDraft): TemplateDraft => ({
  name: template.name,
  description: template.description,
  category: template.category,
  enabled: template.enabled,
  structure: { folders: template.structure.folders.map((folder) => ({ ...folder })) },
});

export default function FolderTemplatesPage() {
  const [templates, setTemplates] = useState<SystemTemplate[]>([]);
  const [selected, setSelected] = useState<SystemTemplate | null>(null);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [conflict, setConflict] = useState(false);
  const dirty = draft !== null && JSON.stringify(draft) !== baseline;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/sysop/folder-templates', { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Unable to load system templates.');
        }
        setTemplates(data.templates);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Unable to load system templates.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const guardLink = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === '_blank' ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }
      if (
        link.href !== window.location.href &&
        !window.confirm('Discard unsaved changes to this system template and leave this page?')
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', guardLink, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', guardLink, true);
    };
  }, [dirty]);

  function open(template: SystemTemplate | null) {
    if (dirty && !window.confirm('Discard unsaved changes to this system template?')) {
      return;
    }
    const next = template ? copyDraft(template) : emptyDraft();
    setSelected(template);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setError('');
    setSuccess('');
    setConflict(false);
  }
  function update(next: TemplateDraft) {
    setDraft(next);
    setError('');
    setSuccess('');
  }

  async function reload() {
    if (dirty && !window.confirm('Reload the latest templates and discard this unsaved draft?')) {
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/sysop/folder-templates');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to reload system templates.');
      }
      setTemplates(data.templates);
      const latest = selected
        ? data.templates.find((item: SystemTemplate) => item.id === selected.id)
        : null;
      const next = latest ? copyDraft(latest) : emptyDraft();
      setSelected(latest || null);
      setDraft(next);
      setBaseline(JSON.stringify(next));
      setConflict(false);
      setSuccess('Latest system templates loaded.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to reload system templates.');
    } finally {
      setLoading(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) {
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(
        selected
          ? `/api/sysop/folder-templates/${encodeURIComponent(selected.id)}`
          : '/api/sysop/folder-templates',
        {
          method: selected ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            selected ? { ...draft, expectedRevision: selected.revision } : draft
          ),
        }
      );
      const data = await response.json();
      if (response.status === 409) {
        setConflict(true);
        throw new Error(
          'This template changed since you opened it. Your draft is preserved. Reload the latest templates before saving again.'
        );
      }
      if (!response.ok) {
        throw new Error(data.error || 'Unable to save system template.');
      }
      const saved: SystemTemplate = data.template;
      setTemplates((current) =>
        current.some((item) => item.id === saved.id)
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved]
      );
      const next = copyDraft(saved);
      setSelected(saved);
      setDraft(next);
      setBaseline(JSON.stringify(next));
      setConflict(false);
      setSuccess(
        'System template saved. The change is available globally for future template use.'
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save system template.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">System folder templates</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
            Platform operators manage these global templates for all organizations. Organization
            administrators select templates using checkboxes when creating a room; they cannot edit
            system templates.
          </p>
        </div>
        <Button className="min-h-12" onClick={() => open(null)} disabled={loading || saving}>
          New system template
        </Button>
      </div>
      <p className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm dark:border-indigo-800 dark:bg-indigo-950">
        Saving changes takes effect immediately across all organizations for future template use.
        Existing rooms and their folders remain unchanged. Disabling a template hides it from future
        selections.
      </p>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 p-4 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}
      {success && (
        <p role="status" className="text-sm text-green-700 dark:text-green-300">
          {success}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
        <Card elevation="flat">
          <CardHeader>
            <h2 className="font-semibold">All system templates</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <p role="status">Loading templates...</p>
            ) : templates.length === 0 ? (
              <p className="text-sm">No system templates found.</p>
            ) : (
              templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  disabled={saving}
                  aria-pressed={selected?.id === template.id}
                  onClick={() => open(template)}
                  className="w-full rounded-lg border border-slate-200 p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-50 dark:border-slate-700"
                >
                  <span className="block break-words font-medium">{template.name}</span>
                  <span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">
                    {template.enabled ? 'Enabled' : 'Disabled'} ·{' '}
                    {template.structure.folders.length} folders
                  </span>
                  <span className="block break-words text-xs text-slate-500">
                    {template.category}
                  </span>
                </button>
              ))
            )}
            <Button
              type="button"
              variant="outline"
              className="min-h-12"
              disabled={saving || loading}
              onClick={() => void reload()}
            >
              Reload latest templates
            </Button>
          </CardContent>
        </Card>
        {draft ? (
          <Card elevation="flat">
            <CardHeader>
              <h2 className="font-semibold">
                {selected ? 'Edit system template' : 'New system template'}
                {dirty ? ' (unsaved)' : ''}
              </h2>
            </CardHeader>
            <CardContent>
              <form
                action={
                  selected
                    ? `/api/sysop/folder-templates/${encodeURIComponent(selected.id)}`
                    : '/api/sysop/folder-templates'
                }
                method="post"
                onSubmit={save}
                className="space-y-5"
              >
                <fieldset disabled={saving} className="space-y-5">
                  <legend className="sr-only">Template details</legend>
                  <div className="space-y-2">
                    <Label htmlFor="template-name">Name (required)</Label>
                    <Input
                      id="template-name"
                      name="name"
                      required
                      maxLength={255}
                      className="min-h-12 text-base"
                      value={draft.name}
                      onChange={(e) => update({ ...draft, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="template-description">Description</Label>
                    <textarea
                      id="template-description"
                      name="description"
                      maxLength={2000}
                      rows={3}
                      className="w-full rounded-md border border-neutral-300 bg-white p-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:bg-neutral-800"
                      value={draft.description}
                      onChange={(e) => update({ ...draft, description: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="template-category">Category (required)</Label>
                    <Input
                      id="template-category"
                      name="category"
                      required
                      maxLength={100}
                      className="min-h-12 text-base"
                      value={draft.category}
                      onChange={(e) => update({ ...draft, category: e.target.value })}
                    />
                  </div>
                  <label htmlFor="template-enabled" className="flex min-h-12 items-center gap-3">
                    <input
                      id="template-enabled"
                      name="enabled"
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) => update({ ...draft, enabled: e.target.checked })}
                      className="h-5 w-5 accent-indigo-600"
                    />
                    Enabled for future room selections
                  </label>
                  <fieldset className="space-y-4">
                    <legend className="font-semibold">Folder definitions</legend>
                    <p id="folder-path-help" className="text-sm text-slate-600 dark:text-slate-300">
                      Use full paths, such as /financials and /financials/budget. Include a
                      definition for each parent folder. Maximum {MAX_FOLDER_DEPTH} folder levels
                      and 100 folders. Removing a definition affects future template use only.
                    </p>
                    {draft.structure.folders.map((folder, index) => (
                      <div
                        key={index}
                        className="grid gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-2"
                      >
                        <div className="space-y-2">
                          <Label htmlFor={`folder-name-${index}`}>
                            Folder {index + 1} name (required)
                          </Label>
                          <Input
                            id={`folder-name-${index}`}
                            name={`folders[${index}].name`}
                            required
                            maxLength={255}
                            className="min-h-12 text-base"
                            value={folder.name}
                            onChange={(e) =>
                              update({
                                ...draft,
                                structure: {
                                  folders: draft.structure.folders.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, name: e.target.value } : row
                                  ),
                                },
                              })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`folder-path-${index}`}>Full path (required)</Label>
                          <Input
                            id={`folder-path-${index}`}
                            name={`folders[${index}].path`}
                            required
                            aria-describedby="folder-path-help"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            className="min-h-12 text-base"
                            value={folder.path}
                            onChange={(e) =>
                              update({
                                ...draft,
                                structure: {
                                  folders: draft.structure.folders.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, path: e.target.value } : row
                                  ),
                                },
                              })
                            }
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-12 justify-self-start"
                          onClick={() =>
                            update({
                              ...draft,
                              structure: {
                                folders: draft.structure.folders.filter(
                                  (_, rowIndex) => rowIndex !== index
                                ),
                              },
                            })
                          }
                        >
                          Remove folder {index + 1}
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-12"
                      disabled={draft.structure.folders.length >= 100}
                      onClick={() =>
                        update({
                          ...draft,
                          structure: {
                            folders: [...draft.structure.folders, { name: '', path: '' }],
                          },
                        })
                      }
                    >
                      Add folder
                    </Button>
                  </fieldset>
                </fieldset>
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="submit"
                    className="min-h-12"
                    disabled={saving || conflict || loading}
                  >
                    {saving ? 'Saving system template...' : 'Save system template'}
                  </Button>
                  {conflict && (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-12"
                      disabled={saving || loading}
                      onClick={() => void reload()}
                    >
                      Reload latest template
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Choose a system template to edit, or create a new one.
          </p>
        )}
      </div>
    </div>
  );
}
