'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  FileText,
  Folder,
  Search,
  Download,
  Eye,
  ChevronRight,
  LogOut,
  Home,
} from 'lucide-react';

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
      const path = currentPath.length > 0 ? `?path=${encodeURIComponent(currentPath.join('/'))}` : '';
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
    fetch(`/api/view/${shareToken}/logout`, { method: 'POST' })
      .finally(() => router.push(`/view/${shareToken}`));
  };

  if (isLoading && !session) {
    return (
      <div className="min-h-screen bg-neutral-50">
        <div className="border-b bg-white">
          <div className="max-w-6xl mx-auto px-4 py-4">
            <Skeleton className="h-8 w-48" />
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 py-8">
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
      <div className="border-b bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4">
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
                <div className="w-8 h-8 rounded-lg bg-primary-600 text-white flex items-center justify-center font-bold">
                  {session?.organizationName.charAt(0) || 'V'}
                </div>
              )}
              <div>
                <h1 className="font-semibold text-neutral-900">{session?.roomName}</h1>
                <p className="text-sm text-neutral-500">{session?.organizationName}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Exit
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Breadcrumb & Search */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={navigateToRoot}
              className="flex-shrink-0"
            >
              <Home className="w-4 h-4" />
            </Button>
            {currentPath.length > 0 && (
              <>
                <ChevronRight className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                {currentPath.map((segment, index) => (
                  <React.Fragment key={index}>
                    {index > 0 && (
                      <ChevronRight className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                    )}
                    <button
                      onClick={() => navigateToPathIndex(index)}
                      className="text-sm text-neutral-600 hover:text-primary-600 truncate max-w-32"
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
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
            <FileText className="w-12 h-12 mx-auto text-neutral-400 mb-4" />
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">
              {searchQuery ? 'No results found' : 'No documents'}
            </h3>
            <p className="text-neutral-500">
              {searchQuery
                ? 'Try a different search term'
                : 'This folder is empty'}
            </p>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Folders */}
            {filteredFolders.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-neutral-500 mb-3">Folders</h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {filteredFolders.map((folder) => (
                    <Card
                      key={folder.id}
                      className="cursor-pointer hover:border-primary-200 hover:shadow-sm transition-all"
                      onClick={() => navigateToFolder(folder.name)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center">
                            <Folder className="w-5 h-5 text-primary-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{folder.name}</p>
                            <p className="text-sm text-neutral-500">
                              {folder.documentCount} items
                            </p>
                          </div>
                          <ChevronRight className="w-5 h-5 text-neutral-400" />
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
                <h2 className="text-sm font-medium text-neutral-500 mb-3">Documents</h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {filteredDocuments.map((doc) => {
                    const FileIcon = getFileIcon(doc.mimeType);
                    return (
                      <Card
                        key={doc.id}
                        className="hover:border-primary-200 hover:shadow-sm transition-all"
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
                              <FileIcon className="w-5 h-5 text-neutral-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate" title={doc.name}>
                                {doc.name}
                              </p>
                              <p className="text-sm text-neutral-500">
                                {formatFileSize(doc.size)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-4">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => handleViewDocument(doc.id)}
                            >
                              <Eye className="w-4 h-4 mr-1" />
                              View
                            </Button>
                            {session?.downloadEnabled && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1"
                                onClick={() => handleDownloadDocument(doc.id)}
                              >
                                <Download className="w-4 h-4 mr-1" />
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
      <div className="border-t bg-white mt-auto">
        <div className="max-w-6xl mx-auto px-4 py-4 text-center text-sm text-neutral-500">
          Secure document sharing powered by VaultSpace
        </div>
      </div>
    </div>
  );
}
