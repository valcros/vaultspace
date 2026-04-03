'use client';

import * as React from 'react';
import { Keyboard, Command, FileText, Navigation } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  shortcuts: ShortcutItem[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    id: 'global',
    title: 'Global Shortcuts',
    description: 'Available anywhere in the application',
    icon: Keyboard,
    shortcuts: [
      { keys: ['⌘', 'K'], description: 'Open command palette' },
      { keys: ['Esc'], description: 'Close dialogs and menus' },
    ],
  },
  {
    id: 'command-palette',
    title: 'Command Palette',
    description: 'Quick navigation when command palette is open',
    icon: Command,
    shortcuts: [
      { keys: ['⌘', 'D'], description: 'Go to Dashboard' },
      { keys: ['⌘', 'R'], description: 'Go to All Rooms' },
      { keys: ['⌘', 'U'], description: 'Go to Users' },
      { keys: ['⌘', ','], description: 'Go to Settings' },
      { keys: ['⌘', 'N'], description: 'Create New Room' },
      { keys: ['↑', '↓'], description: 'Navigate items' },
      { keys: ['Enter'], description: 'Select item' },
    ],
  },
  {
    id: 'document-viewer',
    title: 'Document Viewer',
    description: 'Navigate and control document preview',
    icon: FileText,
    shortcuts: [
      { keys: ['←'], description: 'Previous page' },
      { keys: ['→'], description: 'Next page' },
      { keys: ['+'], description: 'Zoom in' },
      { keys: ['-'], description: 'Zoom out' },
      { keys: ['0'], description: 'Reset zoom to 100%' },
    ],
  },
  {
    id: 'navigation',
    title: 'General Navigation',
    description: 'Standard browser and form navigation',
    icon: Navigation,
    shortcuts: [
      { keys: ['Tab'], description: 'Move to next field' },
      { keys: ['Shift', 'Tab'], description: 'Move to previous field' },
      { keys: ['Space'], description: 'Toggle checkboxes and buttons' },
      { keys: ['Enter'], description: 'Submit forms or confirm actions' },
    ],
  },
];

function KeyboardKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[24px] items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-sm font-medium text-neutral-700 shadow-sm">
      {children}
    </kbd>
  );
}

function ShortcutRow({ shortcut }: { shortcut: ShortcutItem }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-neutral-700">{shortcut.description}</span>
      <div className="flex items-center gap-1">
        {shortcut.keys.map((key, index) => (
          <React.Fragment key={index}>
            <KeyboardKey>{key}</KeyboardKey>
            {index < shortcut.keys.length - 1 && (
              <span className="text-xs text-neutral-400">+</span>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default function KeyboardShortcutsPage() {
  return (
    <>
      <PageHeader
        title="Keyboard Shortcuts"
        description="Learn keyboard shortcuts to navigate VaultSpace more efficiently"
      />

      <div className="p-6">
        <div className="mb-6 rounded-lg border border-blue-100 bg-blue-50 p-4">
          <p className="text-sm text-blue-800">
            <strong>Tip:</strong> Press{' '}
            <kbd className="rounded border border-blue-200 bg-white px-1.5 py-0.5 text-xs">
              ⌘
            </kbd>{' '}
            <kbd className="rounded border border-blue-200 bg-white px-1.5 py-0.5 text-xs">
              K
            </kbd>{' '}
            (or{' '}
            <kbd className="rounded border border-blue-200 bg-white px-1.5 py-0.5 text-xs">
              Ctrl
            </kbd>{' '}
            <kbd className="rounded border border-blue-200 bg-white px-1.5 py-0.5 text-xs">
              K
            </kbd>{' '}
            on Windows) anywhere in VaultSpace to open the command palette for quick navigation.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {shortcutGroups.map((group) => {
            const Icon = group.icon;
            return (
              <Card key={group.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50">
                      <Icon className="h-5 w-5 text-primary-600" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{group.title}</CardTitle>
                      <p className="text-sm text-neutral-500">{group.description}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="divide-y divide-neutral-100">
                    {group.shortcuts.map((shortcut, index) => (
                      <ShortcutRow key={index} shortcut={shortcut} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-8 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <h3 className="mb-2 text-sm font-medium text-neutral-900">Platform Notes</h3>
          <ul className="space-y-1 text-sm text-neutral-600">
            <li>
              <strong>macOS:</strong> Use ⌘ (Command) for shortcuts shown with ⌘
            </li>
            <li>
              <strong>Windows/Linux:</strong> Use Ctrl instead of ⌘
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}
