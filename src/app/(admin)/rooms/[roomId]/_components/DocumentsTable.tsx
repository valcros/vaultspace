'use client';

import * as React from 'react';
import {
  Folder,
  MoreHorizontal,
  Download,
  Eye,
  Trash2,
  History,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
  Lock,
  Tag,
  Square,
  CheckSquare,
  Star,
  Clock,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AdminSurface } from '@/components/layout/admin-page';
import { FileTypeIcon } from '@/components/documents/FileTypeIcon';
import { getCategoryLabel, getCategoryColor } from '@/lib/documentCategories';

import type { Document, FolderItem } from '../_hooks/useRoomContents';
import type { SortField, SortDir } from './DocumentToolbar';

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

/** Per-document action callbacks shared by the list rows and grid cards. */
interface DocumentActionHandlers {
  onPreview: (doc: Document) => void;
  onDownload: (doc: Document) => void;
  onEditProperties: (doc: Document) => void;
  onToggleBookmark: (doc: Document) => void;
  onShowVersions: (doc: Document) => void;
  onToggleConfidential: (doc: Document) => void;
  onDelete: (doc: Document) => void;
  onContextMenu: (e: React.MouseEvent, doc: Document) => void;
}

interface FolderListRowProps {
  folder: FolderItem;
  compact: boolean;
  showSize: boolean;
  showUploaded: boolean;
  onOpen: (folder: FolderItem) => void;
  onDelete: (folder: FolderItem) => void;
}

const FolderListRow = React.memo(function FolderListRow({
  folder,
  compact,
  showSize,
  showUploaded,
  onOpen,
  onDelete,
}: FolderListRowProps) {
  return (
    <tr
      className="cursor-pointer border-b last:border-0 hover:bg-neutral-50"
      onClick={() => onOpen(folder)}
    >
      <td className="w-8 px-2" />
      <td className={`px-3 ${compact ? 'py-1' : 'py-1.5'}`}>
        <div className="flex items-center gap-2">
          <Folder className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} text-yellow-500`} />
          <span className={`font-medium ${compact ? 'text-sm' : ''}`}>{folder.name}</span>
        </div>
      </td>
      {showSize && (
        <td
          className={`hidden px-3 sm:table-cell ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} text-neutral-500`}
        >
          {folder.documentCount} files, {folder.childCount} folders
        </td>
      )}
      {showUploaded && (
        <td
          className={`hidden px-3 sm:table-cell ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} text-neutral-500`}
        >
          {formatDate(folder.createdAt)}
        </td>
      )}
      <td className={`px-2 ${compact ? 'py-0.5' : 'py-1'}`} onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Actions for folder ${folder.name}`}
              className={`${compact ? 'h-6 w-6' : 'h-9 w-9 sm:h-7 sm:w-7'} p-0`}
            >
              <MoreHorizontal aria-hidden="true" className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onOpen(folder)}>
              <Eye className="mr-2 h-4 w-4" />
              Open
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(folder)} className="text-danger-600">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
});

interface DocumentListRowProps extends DocumentActionHandlers {
  doc: Document;
  compact: boolean;
  showSize: boolean;
  showUploaded: boolean;
  selected: boolean;
  bookmarked: boolean;
  allDocumentsConfidential: boolean;
  onToggleSelect: (docId: string) => void;
}

const DocumentListRow = React.memo(function DocumentListRow({
  doc,
  compact,
  showSize,
  showUploaded,
  selected,
  bookmarked,
  allDocumentsConfidential,
  onToggleSelect,
  onPreview,
  onDownload,
  onEditProperties,
  onToggleBookmark,
  onShowVersions,
  onToggleConfidential,
  onDelete,
  onContextMenu,
}: DocumentListRowProps) {
  return (
    <tr
      className={`cursor-pointer border-b last:border-0 hover:bg-neutral-50 ${selected ? 'bg-primary-50' : ''}`}
      onClick={() => onPreview(doc)}
      onContextMenu={(e) => onContextMenu(e, doc)}
    >
      <td
        className="w-8 px-2"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect(doc.id);
        }}
      >
        {selected ? (
          <CheckSquare className="h-4 w-4 text-primary-500" />
        ) : (
          <Square className="h-4 w-4 text-neutral-300" />
        )}
      </td>
      <td className={`px-3 ${compact ? 'py-1' : 'py-1.5'}`}>
        <div className="flex items-center gap-2">
          <FileTypeIcon mimeType={doc.mimeType} className={compact ? 'h-4 w-4' : undefined} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`truncate font-medium ${compact ? 'text-sm' : ''}`}>{doc.name}</span>
              {(doc.confidential || allDocumentsConfidential) && (
                <Lock className="h-3 w-3 shrink-0 text-amber-500" />
              )}
            </div>
            {!compact && (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {doc.category && (
                  <span
                    className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium ${getCategoryColor(doc.category)}`}
                  >
                    {getCategoryLabel(doc.category)}
                  </span>
                )}
                {doc.tags?.map((tag) => (
                  <Badge key={tag} variant="outline" className="px-1 py-0 text-[10px]">
                    {tag}
                  </Badge>
                ))}
                {doc.expiresAt && (
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-orange-200 bg-orange-50 px-1.5 py-0 text-[10px] font-medium text-orange-600">
                    <Clock className="h-2.5 w-2.5" />
                    Expires {new Date(doc.expiresAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
      {showSize && (
        <td
          className={`hidden px-3 sm:table-cell ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} text-neutral-500`}
        >
          {formatFileSize(doc.size)}
        </td>
      )}
      {showUploaded && (
        <td
          className={`hidden px-3 sm:table-cell ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} text-neutral-500`}
        >
          {formatDate(doc.createdAt)}
        </td>
      )}
      <td className={`px-2 ${compact ? 'py-0.5' : 'py-1'}`} onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Actions for ${doc.name}`}
              className={`${compact ? 'h-6 w-6' : 'h-9 w-9 sm:h-7 sm:w-7'} p-0`}
            >
              <MoreHorizontal aria-hidden="true" className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onPreview(doc)}>
              <Eye className="mr-2 h-4 w-4" />
              Preview
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDownload(doc)}>
              <Download className="mr-2 h-4 w-4" />
              Download
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEditProperties(doc)}>
              <Tag className="mr-2 h-4 w-4" />
              Edit Properties
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onToggleBookmark(doc)}>
              <Star
                className={`mr-2 h-4 w-4 ${bookmarked ? 'fill-amber-400 text-amber-400' : ''}`}
              />
              {bookmarked ? 'Remove Bookmark' : 'Bookmark'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onShowVersions(doc)}>
              <History className="mr-2 h-4 w-4" />
              Version History
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onToggleConfidential(doc)}>
              <Lock className="mr-2 h-4 w-4" />
              {doc.confidential ? 'Remove Confidential' : 'Mark Confidential'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(doc)} className="text-danger-600">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
});

interface FolderGridTileProps {
  folder: FolderItem;
  onOpen: (folder: FolderItem) => void;
}

const FolderGridTile = React.memo(function FolderGridTile({ folder, onOpen }: FolderGridTileProps) {
  return (
    <button
      type="button"
      title={folder.name}
      onClick={() => onOpen(folder)}
      className="group flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-3 text-left transition-all hover:border-amber-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:border-slate-800 dark:bg-slate-950/70 dark:hover:border-amber-700"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-900/20">
        <Folder className="h-5 w-5 text-amber-500" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="line-clamp-2 block text-sm font-semibold leading-snug text-neutral-900 dark:text-neutral-100">
          {folder.name}
        </span>
        <span className="block text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
          {folder.documentCount} {folder.documentCount === 1 ? 'file' : 'files'}
        </span>
      </span>
    </button>
  );
});

interface DocumentGridCardProps extends DocumentActionHandlers {
  doc: Document;
  roomId: string;
  bookmarked: boolean;
  allDocumentsConfidential: boolean;
}

const DocumentGridCard = React.memo(function DocumentGridCard({
  doc,
  roomId,
  bookmarked,
  allDocumentsConfidential,
  onPreview,
  onDownload,
  onEditProperties,
  onToggleBookmark,
  onShowVersions,
  onToggleConfidential,
  onDelete,
  onContextMenu,
}: DocumentGridCardProps) {
  return (
    <div
      className="group relative cursor-pointer rounded-xl border border-slate-200/80 bg-white p-3 transition-all duration-150 hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/70 dark:hover:border-primary-700"
      onClick={() => onPreview(doc)}
      onContextMenu={(e) => onContextMenu(e, doc)}
    >
      <DocumentThumbnail
        docId={doc.id}
        roomId={roomId}
        mimeType={doc.mimeType}
        confidential={doc.confidential || allDocumentsConfidential || false}
        updatedAt={doc.updatedAt}
      />
      <div className="mt-2 flex items-center gap-1">
        <p className="truncate text-sm font-medium">{doc.name}</p>
        {(doc.confidential || allDocumentsConfidential) && (
          <Lock className="h-3 w-3 shrink-0 text-amber-500" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <p className="text-xs text-neutral-600">{formatFileSize(doc.size)}</p>
        {doc.category && (
          <span
            className={`rounded-full border px-1.5 text-[9px] font-medium ${getCategoryColor(doc.category)}`}
          >
            {getCategoryLabel(doc.category)}
          </span>
        )}
        {doc.expiresAt && (
          <span className="inline-flex items-center gap-0.5 rounded-full border border-orange-200 bg-orange-50 px-1.5 text-[9px] font-medium text-orange-600">
            <Clock className="h-2.5 w-2.5" />
            {new Date(doc.expiresAt).toLocaleDateString()}
          </span>
        )}
      </div>
      {/* Action menu */}
      <div
        className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 w-7 p-0 shadow-sm"
              aria-label={`Actions for ${doc.name}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onPreview(doc)}>
              <Eye className="mr-2 h-4 w-4" />
              Preview
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDownload(doc)}>
              <Download className="mr-2 h-4 w-4" />
              Download
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEditProperties(doc)}>
              <Tag className="mr-2 h-4 w-4" />
              Edit Properties
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onToggleBookmark(doc)}>
              <Star
                className={`mr-2 h-4 w-4 ${bookmarked ? 'fill-amber-400 text-amber-400' : ''}`}
              />
              {bookmarked ? 'Remove Bookmark' : 'Bookmark'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onShowVersions(doc)}>
              <History className="mr-2 h-4 w-4" />
              Version History
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onToggleConfidential(doc)}>
              <Lock className="mr-2 h-4 w-4" />
              {doc.confidential ? 'Remove Confidential' : 'Mark Confidential'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(doc)} className="text-danger-600">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});

export interface DocumentsTableProps extends DocumentActionHandlers {
  /** Which layout to render; matches the page's persisted view mode. */
  view: 'list' | 'grid';
  roomId: string;
  /** Room-level override that marks every document confidential. */
  allDocumentsConfidential: boolean;
  folders: FolderItem[];
  /** Documents pre-sorted by the page-level toolbar sort. */
  documents: Document[];
  compact: boolean;
  visibleColumns: Record<string, boolean>;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  selectedDocs: Set<string>;
  onToggleSelectAll: () => void;
  onToggleDocSelection: (docId: string) => void;
  bookmarkedDocs: Set<string>;
  onFolderClick: (folder: FolderItem) => void;
  onFolderDelete: (folder: FolderItem) => void;
}

/**
 * Room contents listing: the list-view table (sortable headers, selection,
 * per-row action menus) and the grid view (compact folder tiles + document
 * preview cards). Rows, tiles, and cards are memoized; the page passes
 * referentially stable callbacks so memoization holds.
 */
export function DocumentsTable({
  view,
  roomId,
  allDocumentsConfidential,
  folders,
  documents,
  compact,
  visibleColumns,
  sortField,
  sortDir,
  onSort,
  selectedDocs,
  onToggleSelectAll,
  onToggleDocSelection,
  bookmarkedDocs,
  onFolderClick,
  onFolderDelete,
  onPreview,
  onDownload,
  onEditProperties,
  onToggleBookmark,
  onShowVersions,
  onToggleConfidential,
  onDelete,
  onContextMenu,
}: DocumentsTableProps) {
  const docHandlers: DocumentActionHandlers = {
    onPreview,
    onDownload,
    onEditProperties,
    onToggleBookmark,
    onShowVersions,
    onToggleConfidential,
    onDelete,
    onContextMenu,
  };

  if (view === 'list') {
    return (
      <AdminSurface className="overflow-hidden p-0">
        <table className="w-full" aria-label="Room contents">
          <thead className="border-b border-slate-200/80 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/70">
            <tr>
              <th className="w-8 px-2 py-2">
                <button
                  onClick={onToggleSelectAll}
                  aria-label={
                    selectedDocs.size > 0 && selectedDocs.size === documents.length
                      ? 'Deselect all'
                      : 'Select all'
                  }
                  className="flex items-center text-neutral-500 hover:text-neutral-600"
                >
                  {selectedDocs.size > 0 && selectedDocs.size === documents.length ? (
                    <CheckSquare className="h-4 w-4 text-primary-500" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </button>
              </th>
              <th
                className="cursor-pointer select-none px-3 py-2 text-left text-xs font-medium text-neutral-500 hover:text-neutral-700"
                onClick={() => onSort('name')}
              >
                <span className="inline-flex items-center gap-1">
                  Name
                  {sortField === 'name' ? (
                    sortDir === 'asc' ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                  )}
                </span>
              </th>
              {visibleColumns['size'] && (
                <th
                  className="hidden cursor-pointer select-none px-3 py-2 text-left text-xs font-medium text-neutral-500 hover:text-neutral-700 sm:table-cell"
                  onClick={() => onSort('size')}
                >
                  <span className="inline-flex items-center gap-1">
                    Size
                    {sortField === 'size' ? (
                      sortDir === 'asc' ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )
                    ) : null}
                  </span>
                </th>
              )}
              {visibleColumns['uploaded'] && (
                <th
                  className="hidden cursor-pointer select-none px-3 py-2 text-left text-xs font-medium text-neutral-500 hover:text-neutral-700 sm:table-cell"
                  onClick={() => onSort('createdAt')}
                >
                  <span className="inline-flex items-center gap-1">
                    Uploaded
                    {sortField === 'createdAt' ? (
                      sortDir === 'asc' ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )
                    ) : null}
                  </span>
                </th>
              )}
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {/* Render folders first */}
            {folders.map((folder) => (
              <FolderListRow
                key={folder.id}
                folder={folder}
                compact={compact}
                showSize={Boolean(visibleColumns['size'])}
                showUploaded={Boolean(visibleColumns['uploaded'])}
                onOpen={onFolderClick}
                onDelete={onFolderDelete}
              />
            ))}
            {/* Render documents */}
            {documents.map((doc) => (
              <DocumentListRow
                key={doc.id}
                doc={doc}
                compact={compact}
                showSize={Boolean(visibleColumns['size'])}
                showUploaded={Boolean(visibleColumns['uploaded'])}
                selected={selectedDocs.has(doc.id)}
                bookmarked={bookmarkedDocs.has(doc.id)}
                allDocumentsConfidential={allDocumentsConfidential}
                onToggleSelect={onToggleDocSelection}
                {...docHandlers}
              />
            ))}
          </tbody>
        </table>
      </AdminSurface>
    );
  }

  /* Grid / Thumbnail View */
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {/* Folders — compact name-first tiles (Drive convention): the name
          is the significant information, the icon just types the tile.
          Documents keep the tall preview cards; the height difference is
          the visual distinction between containers and content. */}
      {folders.map((folder) => (
        <FolderGridTile key={folder.id} folder={folder} onOpen={onFolderClick} />
      ))}
      {/* Documents — render the same sorted view the list mode uses
              so the grid and list stay coherent regardless of how the
              user sorted via the toolbar. */}
      {documents.map((doc) => (
        <DocumentGridCard
          key={doc.id}
          doc={doc}
          roomId={roomId}
          bookmarked={bookmarkedDocs.has(doc.id)}
          allDocumentsConfidential={allDocumentsConfidential}
          {...docHandlers}
        />
      ))}
    </div>
  );
}

/**
 * Thumbnail for grid view — tries to load preview image, falls back to file type icon.
 */
function DocumentThumbnail({
  docId,
  roomId,
  mimeType,
  confidential = false,
  updatedAt,
}: {
  docId: string;
  roomId: string;
  mimeType: string;
  confidential?: boolean;
  updatedAt?: string;
}) {
  const [failed, setFailed] = React.useState(false);

  if (confidential) {
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center rounded-lg bg-amber-50">
        <Lock className="mb-1 h-8 w-8 text-amber-400" />
        <span className="text-[10px] font-medium text-amber-500">Confidential</span>
      </div>
    );
  }

  return (
    <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-neutral-50">
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/rooms/${roomId}/documents/${docId}/thumbnail?v=${updatedAt || '1'}`}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <FileTypeIcon mimeType={mimeType} className="h-12 w-12" />
      )}
    </div>
  );
}
