'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FileText, Folder, Search, Download, Eye, ChevronRight, Home, History } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ViewerShell } from '@/components/layout/viewer-shell';

interface ViewerSession {
  roomName: string;
  organizationName: string;
  organizationLogo: string | null;
  brandColor: string | null;
  downloadEnabled: boolean;
  watermarkEnabled: boolean;
  versionHistoryEnabled: boolean;
}

interface DocumentVersionInfo {
  id: string;
  versionNumber: number;
  size: number;
  createdAt: string;
  isCurrent: boolean;
}

interface Document {
  id: string;
  name: string;
  accessionNumber: string | null;
  totalVersions?: number;
  withdrawn?: boolean;
  mimeType: string;
  size: number;
  folderId: string | null;
  folderPath: string | null;
  createdAt: string;
}

interface Folder {
  id: string;
  name: string;
  path: string;
  documentCount: number;
}

export default function ViewerDocumentsPage() {
  const params = useParams();
  const router = useRouter();
  const shareToken = params['shareToken'] as string;

  const [session, setSession] = React.useState<ViewerSession | null>(null);
  const [documents, setDocuments] = React.useState<Document[]>([]);
  const [folders, setFolders] = React.useState<Folder[]>([]);
  // Breadcrumb trail from root to the current folder, tracked by immutable
  // folder id (never a display-derived path string, which is what caused folders
  // to open empty). Each entry keeps the name only for breadcrumb display.
  const [trail, setTrail] = React.useState<{ id: string; name: string }[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState('');

  const currentFolderId = trail.at(-1)?.id ?? null;
  const folderKey = trail.map((t) => t.id).join('/');

  const fetchDocuments = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const query = currentFolderId ? `?folderId=${encodeURIComponent(currentFolderId)}` : '';
      const response = await fetch(`/api/view/${shareToken}/documents${query}`);
      const data = await response.json();

      if (!response.ok) {
        router.push(`/view/${shareToken}`);
        return;
      }

      setSession(data.session);
      setDocuments(data.documents || []);
      setFolders(data.folders || []);
    } catch (error) {
      console.error('Failed to fetch documents:', error);
      router.push(`/view/${shareToken}`);
    } finally {
      setIsLoading(false);
    }
  }, [shareToken, currentFolderId, router]);

  React.useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments, folderKey]);

  const navigateToFolder = (folder: { id: string; name: string }) => {
    setTrail((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const navigateToRoot = () => {
    setTrail([]);
  };

  const navigateToPathIndex = (index: number) => {
    setTrail((prev) => prev.slice(0, index + 1));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (_mimeType: string) => {
    // Return appropriate icon based on mime type
    return FileText;
  };

  const filteredDocuments = documents.filter((doc) =>
    doc.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredFolders = folders.filter((folder) =>
    folder.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleViewDocument = (documentId: string) => {
    router.push(`/view/${shareToken}/documents/${documentId}`);
  };

  const handleDownloadDocument = async (documentId: string, versionId?: string) => {
    const q = versionId ? `?versionId=${encodeURIComponent(versionId)}` : '';
    window.open(`/api/view/${shareToken}/documents/${documentId}/download${q}`, '_blank');
  };

  const [openVersionsDocId, setOpenVersionsDocId] = React.useState<string | null>(null);
  const [versionsByDoc, setVersionsByDoc] = React.useState<Record<string, DocumentVersionInfo[]>>(
    {}
  );
  const [versionsLoading, setVersionsLoading] = React.useState(false);

  const toggleVersions = async (documentId: string) => {
    if (openVersionsDocId === documentId) {
      setOpenVersionsDocId(null);
      return;
    }
    setOpenVersionsDocId(documentId);
    if (!versionsByDoc[documentId]) {
      setVersionsLoading(true);
      try {
        const res = await fetch(`/api/view/${shareToken}/documents/${documentId}/versions`);
        if (res.ok) {
          const data = await res.json();
          setVersionsByDoc((prev) => ({ ...prev, [documentId]: data.versions || [] }));
        }
      } catch {
        // Leave the panel empty on failure.
      } finally {
        setVersionsLoading(false);
      }
    }
  };

  const handleLogout = () => {
    // Clear viewer session and redirect
    fetch(`/api/view/${shareToken}/logout`, { method: 'POST' }).finally(() =>
      router.push(`/view/${shareToken}`)
    );
  };

  if (isLoading && !session) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-8 dark:bg-neutral-950">
        <div className="mx-auto max-w-6xl space-y-6">
          <Skeleton className="h-20 w-full rounded-[1.75rem]" />
          <Skeleton className="h-24 w-full rounded-[1.5rem]" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-[1.25rem]" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <ViewerShell
      session={session}
      shareToken={shareToken}
      activeSection="documents"
      onExit={handleLogout}
    >
      {/* Breadcrumb & Search */}
      <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Breadcrumb */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={navigateToRoot}
              className="flex-shrink-0 rounded-xl"
            >
              <Home className="h-4 w-4" />
            </Button>
            {trail.length > 0 && (
              <>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-neutral-400" />
                {trail.map((segment, index) => (
                  <React.Fragment key={segment.id}>
                    {index > 0 && (
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-neutral-400" />
                    )}
                    <button
                      onClick={() => navigateToPathIndex(index)}
                      className="max-w-32 truncate rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                    >
                      {segment.name}
                    </button>
                  </React.Fragment>
                ))}
              </>
            )}
          </div>

          {/* Search */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-11 rounded-xl border-slate-200 bg-white pl-10 shadow-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : filteredFolders.length === 0 && filteredDocuments.length === 0 ? (
        <Card className="rounded-xl border border-neutral-200 bg-white p-12 text-center shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
          <FileText className="mx-auto mb-4 h-12 w-12 text-slate-400 dark:text-slate-500" />
          <h3 className="mb-2 text-lg font-semibold text-slate-950 dark:text-white">
            {searchQuery ? 'No results found' : 'No documents'}
          </h3>
          <p className="text-slate-500 dark:text-slate-400">
            {searchQuery ? 'Try a different search term' : 'This folder is empty'}
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Folders */}
          {filteredFolders.length > 0 && (
            <div>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Folders
              </h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {filteredFolders.map((folder) => (
                  <Card
                    key={folder.id}
                    className="cursor-pointer rounded-xl border border-neutral-200 bg-white shadow-sm transition-shadow hover:border-primary-200 hover:shadow-md dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-800"
                    onClick={() => navigateToFolder({ id: folder.id, name: folder.name })}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/30">
                          <Folder className="h-5 w-5 text-sky-600 dark:text-sky-300" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-950 dark:text-white">
                            {folder.name}
                          </p>
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            {folder.documentCount} items
                          </p>
                        </div>
                        <ChevronRight className="h-5 w-5 text-slate-400 dark:text-slate-500" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Documents */}
          {filteredDocuments.length > 0 && (
            <div>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Documents
              </h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {filteredDocuments.map((doc) => {
                  const FileIcon = getFileIcon(doc.mimeType);
                  return (
                    <Card
                      key={doc.id}
                      className="rounded-xl border border-neutral-200 bg-white shadow-sm transition-shadow hover:border-primary-200 hover:shadow-md dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-800"
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900">
                            <FileIcon className="h-5 w-5 text-slate-600 dark:text-slate-300" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate font-medium text-slate-950 dark:text-white"
                              title={doc.name}
                            >
                              {doc.name}
                            </p>
                            <p className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                              {doc.accessionNumber && (
                                <span
                                  className="rounded border border-slate-200 bg-slate-50 px-1.5 font-mono text-[10px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                                  title="Document reference number"
                                >
                                  {doc.accessionNumber}
                                  {doc.totalVersions && doc.totalVersions > 1
                                    ? ` · v${doc.totalVersions}`
                                    : ''}
                                </span>
                              )}
                              {formatFileSize(doc.size)}
                            </p>
                          </div>
                        </div>
                        {doc.withdrawn ? (
                          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
                            Withdrawn — this document is no longer available.
                          </div>
                        ) : (
                          <div className="mt-4 flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => handleViewDocument(doc.id)}
                            >
                              <Eye className="mr-1 h-4 w-4" />
                              View
                            </Button>
                            {session?.downloadEnabled && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1"
                                onClick={() => handleDownloadDocument(doc.id)}
                              >
                                <Download className="mr-1 h-4 w-4" />
                                Download
                              </Button>
                            )}
                            {session?.versionHistoryEnabled &&
                              doc.totalVersions !== undefined &&
                              doc.totalVersions > 1 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => toggleVersions(doc.id)}
                                  title="Version history"
                                >
                                  <History className="mr-1 h-4 w-4" />v{doc.totalVersions}
                                </Button>
                              )}
                          </div>
                        )}
                        {!doc.withdrawn &&
                          session?.versionHistoryEnabled &&
                          openVersionsDocId === doc.id && (
                            <div className="mt-3 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
                              {versionsLoading && !versionsByDoc[doc.id] ? (
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                  Loading version history…
                                </p>
                              ) : (versionsByDoc[doc.id]?.length ?? 0) === 0 ? (
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                  No version history available.
                                </p>
                              ) : (
                                versionsByDoc[doc.id]?.map((v) => (
                                  <div
                                    key={v.id}
                                    className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300"
                                  >
                                    <span className="truncate">
                                      v{v.versionNumber}
                                      {v.isCurrent ? ' · current' : ''} ·{' '}
                                      {new Date(v.createdAt).toLocaleDateString()} ·{' '}
                                      {formatFileSize(v.size)}
                                    </span>
                                    {session?.downloadEnabled && (
                                      <button
                                        onClick={() => handleDownloadDocument(doc.id, v.id)}
                                        className="flex-shrink-0 rounded px-2 py-0.5 text-primary-600 hover:bg-primary-50 hover:underline dark:text-primary-400 dark:hover:bg-primary-950/30"
                                      >
                                        Download
                                      </button>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </ViewerShell>
  );
}
