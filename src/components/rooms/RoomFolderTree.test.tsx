/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { RoomFolderTree, RoomFolderTreeNode } from './RoomFolderTree';

const sampleFolders: RoomFolderTreeNode[] = [
  {
    id: 'fld-fin',
    name: 'Financials',
    parentId: null,
    path: '/Financials',
    depth: 1,
    childCount: 1,
  },
  {
    id: 'fld-2025',
    name: '2025',
    parentId: 'fld-fin',
    path: '/Financials/2025',
    depth: 2,
    childCount: 0,
  },
  {
    id: 'fld-legal',
    name: 'Legal',
    parentId: null,
    path: '/Legal',
    depth: 1,
    childCount: 0,
  },
];

function Harness({
  initialExpanded = new Set<string>(),
  onSelect = () => {},
  onToggleExpand,
}: {
  initialExpanded?: Set<string>;
  onSelect?: (id: string | null) => void;
  onToggleExpand?: (id: string) => void;
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(initialExpanded);
  return (
    <RoomFolderTree
      folders={sampleFolders}
      selectedFolderId={null}
      expandedFolderIds={expanded}
      onSelect={onSelect}
      onToggleExpand={(id) => {
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
        onToggleExpand?.(id);
      }}
    />
  );
}

describe('RoomFolderTree keyboard focus', () => {
  it('moves DOM focus to the next visible row on ArrowDown', () => {
    render(<Harness />);
    const items = screen.getAllByRole('treeitem');
    // root, Financials, Legal
    expect(items).toHaveLength(3);
    items[0]!.focus();
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(items[1]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[2]);
  });

  it('expands a folder on ArrowRight and moves DOM focus into its first child on a second ArrowRight', () => {
    render(<Harness />);
    const initial = screen.getAllByRole('treeitem');
    const financialsRow = initial.find((el) => el.getAttribute('aria-level') === '2');
    expect(financialsRow).toBeDefined();
    financialsRow!.focus();

    fireEvent.keyDown(financialsRow!, { key: 'ArrowRight' });
    // Tree re-renders with the child visible.
    const afterExpand = screen.getAllByRole('treeitem');
    expect(afterExpand).toHaveLength(4);

    fireEvent.keyDown(afterExpand[1]!, { key: 'ArrowRight' });
    const childRow = afterExpand[2];
    expect(document.activeElement).toBe(childRow);
  });

  it('selects the focused node when Enter is pressed', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const items = screen.getAllByRole('treeitem');
    items[1]!.focus();
    fireEvent.keyDown(items[1]!, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('fld-fin');
  });
});
