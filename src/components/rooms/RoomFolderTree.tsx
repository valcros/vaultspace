'use client';

import * as React from 'react';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export interface RoomFolderTreeNode {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  depth: number;
  childCount: number;
}

interface RoomFolderTreeProps {
  folders: RoomFolderTreeNode[];
  selectedFolderId: string | null;
  expandedFolderIds: Set<string>;
  onSelect: (folderId: string | null) => void;
  onToggleExpand: (folderId: string) => void;
  /**
   * Render the room root as an "All folders" virtual node so users can
   * always navigate back to the top from the tree.
   */
  rootLabel?: string;
}

interface InternalNode extends RoomFolderTreeNode {
  children: InternalNode[];
}

function buildTree(folders: RoomFolderTreeNode[]): InternalNode[] {
  const byId = new Map<string, InternalNode>();
  for (const f of folders) {
    byId.set(f.id, { ...f, children: [] });
  }
  const roots: InternalNode[] = [];
  byId.forEach((node) => {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortChildren = (nodes: InternalNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of nodes) {
      sortChildren(n.children);
    }
  };
  sortChildren(roots);
  return roots;
}

function flattenVisible(
  nodes: InternalNode[],
  expandedIds: Set<string>,
  level = 0,
  out: Array<{ node: InternalNode; level: number }> = []
): Array<{ node: InternalNode; level: number }> {
  for (const node of nodes) {
    out.push({ node, level });
    if (expandedIds.has(node.id) && node.children.length > 0) {
      flattenVisible(node.children, expandedIds, level + 1, out);
    }
  }
  return out;
}

export function RoomFolderTree({
  folders,
  selectedFolderId,
  expandedFolderIds,
  onSelect,
  onToggleExpand,
  rootLabel = 'All folders',
}: RoomFolderTreeProps) {
  const tree = React.useMemo(() => buildTree(folders), [folders]);
  const visible = React.useMemo(
    () => flattenVisible(tree, expandedFolderIds),
    [tree, expandedFolderIds]
  );

  // Maintain DOM-level keyboard focus on a single row so arrow keys traverse.
  const [focusedId, setFocusedId] = React.useState<string | 'root' | null>(
    selectedFolderId ?? 'root'
  );

  // Track the row element for each visible node so we can call .focus() on
  // the newly focused row after ArrowDown/Up. Without this the browser focus
  // stays on the previously focused DOM element and Enter/Space act on the
  // wrong node, and screen-reader focus never tracks the highlight.
  const rowRefs = React.useRef<Map<'root' | string, HTMLDivElement | null>>(new Map());
  const setRowRef = React.useCallback(
    (id: 'root' | string) => (el: HTMLDivElement | null) => {
      rowRefs.current.set(id, el);
    },
    []
  );
  // Only move actual DOM focus when the keyboard caused the focus change,
  // not when an upstream selection update flips focusedId.
  const shouldFocusDomRef = React.useRef(false);

  React.useEffect(() => {
    if (selectedFolderId) {
      setFocusedId(selectedFolderId);
    }
  }, [selectedFolderId]);

  React.useEffect(() => {
    if (!shouldFocusDomRef.current || !focusedId) {
      return;
    }
    shouldFocusDomRef.current = false;
    const el = rowRefs.current.get(focusedId);
    if (el && document.activeElement !== el) {
      el.focus();
    }
  }, [focusedId]);

  const visibleIds = React.useMemo<Array<'root' | string>>(
    () => ['root', ...visible.map((v) => v.node.id)],
    [visible]
  );

  const moveFocus = (delta: number) => {
    shouldFocusDomRef.current = true;
    const currentIndex = focusedId ? visibleIds.indexOf(focusedId) : -1;
    if (currentIndex === -1) {
      setFocusedId(visibleIds[0] ?? null);
      return;
    }
    const nextIndex = Math.min(visibleIds.length - 1, Math.max(0, currentIndex + delta));
    const next = visibleIds[nextIndex];
    if (next) {
      setFocusedId(next);
    }
  };

  const focusNode = (id: 'root' | string) => {
    shouldFocusDomRef.current = true;
    setFocusedId(id);
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    nodeId: 'root' | string,
    nodeChildCount: number,
    isExpanded: boolean,
    parentId: string | null
  ) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (nodeId !== 'root' && nodeChildCount > 0 && !isExpanded) {
          onToggleExpand(nodeId);
        } else if (nodeId !== 'root' && nodeChildCount > 0 && isExpanded) {
          moveFocus(1);
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (nodeId !== 'root' && isExpanded) {
          onToggleExpand(nodeId);
        } else if (parentId) {
          focusNode(parentId);
        } else {
          focusNode('root');
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSelect(nodeId === 'root' ? null : nodeId);
        break;
      default:
        break;
    }
  };

  const renderNode = (node: InternalNode, level: number) => {
    const isExpanded = expandedFolderIds.has(node.id);
    const isSelected = selectedFolderId === node.id;
    const hasChildren = node.childCount > 0;
    const isFocused = focusedId === node.id;
    return (
      <div
        key={node.id}
        ref={setRowRef(node.id)}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
        aria-level={level + 2}
        tabIndex={isFocused ? 0 : -1}
        onKeyDown={(e) => handleKeyDown(e, node.id, node.childCount, isExpanded, node.parentId)}
        onFocus={() => setFocusedId(node.id)}
        className="outline-none"
      >
        <div
          className={cn(
            'group flex w-full items-center gap-1 rounded-md py-1.5 pr-2 text-sm transition-colors',
            isSelected
              ? 'bg-primary-50 text-primary-800 ring-1 ring-inset ring-primary-200 dark:bg-primary-900/30 dark:text-primary-100 dark:ring-primary-800'
              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60'
          )}
          style={{ paddingLeft: `${0.5 + level * 0.75}rem` }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(node.id);
              }}
              aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
              className="flex h-5 w-5 flex-none items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700"
              tabIndex={-1}
            >
              <ChevronRight
                className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-90')}
                aria-hidden="true"
              />
            </button>
          ) : (
            <span className="h-5 w-5 flex-none" aria-hidden="true" />
          )}
          <button
            type="button"
            onClick={() => onSelect(node.id)}
            className="flex min-w-0 flex-1 items-center gap-2 truncate text-left"
            tabIndex={-1}
          >
            {isExpanded ? (
              <FolderOpen
                className="h-4 w-4 flex-none text-primary-600 dark:text-primary-300"
                aria-hidden="true"
              />
            ) : (
              <Folder className="h-4 w-4 flex-none text-slate-400" aria-hidden="true" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
        </div>
        {hasChildren && isExpanded && (
          <div role="group">{node.children.map((child) => renderNode(child, level + 1))}</div>
        )}
      </div>
    );
  };

  const rootSelected = selectedFolderId === null;
  const rootFocused = focusedId === 'root';

  return (
    <div role="tree" aria-label="Folder tree" className="flex flex-col">
      <div
        ref={setRowRef('root')}
        role="treeitem"
        aria-selected={rootSelected}
        aria-level={1}
        tabIndex={rootFocused ? 0 : -1}
        onKeyDown={(e) => handleKeyDown(e, 'root', tree.length, true, null)}
        onFocus={() => setFocusedId('root')}
        className="outline-none"
      >
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
            rootSelected
              ? 'bg-primary-50 text-primary-800 ring-1 ring-inset ring-primary-200 dark:bg-primary-900/30 dark:text-primary-100 dark:ring-primary-800'
              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60'
          )}
        >
          <Folder className="h-4 w-4 flex-none text-slate-400" aria-hidden="true" />
          <span className="truncate font-medium">{rootLabel}</span>
        </button>
      </div>
      <div role="group" className="mt-1">
        {tree.map((node) => renderNode(node, 0))}
      </div>
    </div>
  );
}
