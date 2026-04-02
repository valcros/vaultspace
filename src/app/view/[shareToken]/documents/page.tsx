'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FileText, Folder, Search, Download, Eye, ChevronRight, LogOut, Home, MessageCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface ViewerSession {
  roomName: string;
  organizationName: string;
  organizationLogo: string | null;
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
      <div className="min-h-screen bg-neutral-50">
        <div className="border-b bg-white">
          <div className="mx-auto max-w-6xl px-4 py-4">
            <Skeleton className="h-8 w-48" />
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {session?.organizationLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.organizationLogo}
                  alt={session.organizationName}
                  className="h-8 object-contain"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 font-bold text-white">
                  {session?.organizationName.charAt(0) || 'V'}
                </div>
              )}
              <div>
                <h1 className="font-semibold text-neutral-900">{session?.roomName}</h1>
                <p className="text-sm text-neutral-500">{session?.organizationName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/view/${shareToken}/questions`)}
              >
                <MessageCircle className="mr-2 h-4 w-4" />
                Q&amp;A
              </Button>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                Exit
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Breadcrumb & Search */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row">
          {/* Breadcrumb */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={navigateToRoot} className="flex-shrink-0">
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
                      className="max-w-32 truncate text-sm text-neutral-600 hover:text-primary-600"
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
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <Input
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
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
          <Card className="p-12 text-center">
            <FileText className="mx-auto mb-4 h-12 w-12 text-neutral-400" />
            <h3 className="mb-2 text-lg font-semibold text-neutral-900">
              {searchQuery ? 'No results found' : 'No documents'}
            </h3>
            <p className="text-neutral-500">
              {searchQuery ? 'Try a different search term' : 'This folder is empty'}
            </p>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Folders */}
            {filteredFolders.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-medium text-neutral-500">Folders</h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {filteredFolders.map((folder) => (
                    <Card
                      key={folder.id}
                      className="cursor-pointer transition-all hover:border-primary-200 hover:shadow-sm"
                      onClick={() => navigateToFolder(folder.name)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50">
                            <Folder className="h-5 w-5 text-primary-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{folder.name}</p>
                            <p className="text-sm text-neutral-500">{folder.documentCount} items</p>
                          </div>
                          <ChevronRight className="h-5 w-5 text-neutral-400" />
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
                <h2 className="mb-3 text-sm font-medium text-neutral-500">Documents</h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {filteredDocuments.map((doc) => {
                    const FileIcon = getFileIcon(doc.mimeType);
                    return (
                      <Card
                        key={doc.id}
                        className="transition-all hover:border-primary-200 hover:shadow-sm"
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100">
                              <FileIcon className="h-5 w-5 text-neutral-600" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium" title={doc.name}>
                                {doc.name}
                              </p>
                              <p className="text-sm text-neutral-500">{formatFileSize(doc.size)}</p>
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
      </div>

      {/* Footer */}
      <div className="mt-auto border-t bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 text-center text-sm text-neutral-500">
          Secure document sharing powered by VaultSpace
        </div>
      </div>
    </div>
  );
}
