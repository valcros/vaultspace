'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FileText, Folder, Search, Download, Eye, ChevronRight, Home } from 'lucide-react';

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
}

interface Document {
  id: string;
  name: string;
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
  const [currentPath, setCurrentPath] = React.useState<string[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState('');

  const pathKey = currentPath.join('/');

  const fetchDocuments = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const path =
        currentPath.length > 0 ? `?path=${encodeURIComponent(currentPath.join('/'))}` : '';
      const response = await fetch(`/api/view/${shareToken}/documents${path}`);
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
  }, [shareToken, currentPath, router]);

  React.useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments, pathKey]);

  const navigateToFolder = (folderName: string) => {
    setCurrentPath([...currentPath, folderName]);
  };

  const navigateToRoot = () => {
    setCurrentPath([]);
  };

  const navigateToPathIndex = (index: number) => {
    setCurrentPath(currentPath.slice(0, index + 1));
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

  const handleDownloadDocument = async (documentId: string) => {
    window.open(`/api/view/${shareToken}/documents/${documentId}/download`, '_blank');
  };

  const handleLogout = () => {
    // Clear viewer session and redirect
    fetch(`/api/view/${shareToken}/logout`, { method: 'POST' }).finally(() =>
      router.push(`/view/${shareToken}`)
    );
  };

  if (isLoading && !session) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef3ff_46%,#f8fafc_100%)] px-4 py-8 dark:bg-[linear-gradient(180deg,#020617_0%,#0f172a_40%,#111827_100%)]">
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
      <div className="bg-white/88 mb-6 rounded-[1.5rem] border border-slate-200/80 p-4 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.35)] ring-1 ring-white/50 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/75 dark:ring-white/5">
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
            {currentPath.length > 0 && (
              <>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-neutral-400" />
                {currentPath.map((segment, index) => (
                  <React.Fragment key={index}>
                    {index > 0 && (
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-neutral-400" />
                    )}
                    <button
                      onClick={() => navigateToPathIndex(index)}
                      className="max-w-32 truncate rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                    >
                      {segment}
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
        <Card className="bg-white/88 rounded-[1.5rem] border-slate-200/80 p-12 text-center shadow-[0_20px_42px_-34px_rgba(15,23,42,0.35)] ring-1 ring-white/50 dark:border-slate-800 dark:bg-slate-950/75 dark:ring-white/5">
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
              <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Folders
              </h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {filteredFolders.map((folder) => (
                  <Card
                    key={folder.id}
                    className="bg-white/88 cursor-pointer rounded-[1.25rem] border-slate-200/80 transition-all hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-sm dark:border-slate-800 dark:bg-slate-950/75 dark:hover:border-sky-800"
                    onClick={() => navigateToFolder(folder.name)}
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
              <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Documents
              </h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {filteredDocuments.map((doc) => {
                  const FileIcon = getFileIcon(doc.mimeType);
                  return (
                    <Card
                      key={doc.id}
                      className="bg-white/88 rounded-[1.25rem] border-slate-200/80 transition-all hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-sm dark:border-slate-800 dark:bg-slate-950/75 dark:hover:border-sky-800"
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
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                              {formatFileSize(doc.size)}
                            </p>
                          </div>
                        </div>
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
                        </div>
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
