'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Trash2,
  RotateCcw,
  AlertTriangle,
  FileText,
  FolderOpen,
  Clock,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';

interface DeletedDocument {
  id: string;
  name: string;
  mimeType: string;
  deletedAt: string;
  permanentDeletionDate: string;
  daysUntilPermanentDeletion: number;
  folder: {
    id: string;
    name: string;
    path: string;
  } | null;
  versions: Array<{
    versionNumber: number;
    uploadedByUser: {
      firstName: string;
      lastName: string;
    } | null;
  }>;
}

interface TrashData {
  documents: DeletedDocument[];
  retentionDays: number;
}

export default function RoomTrashPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params['roomId'] as string;

  const [trashData, setTrashData] = React.useState<TrashData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [restoringIds, setRestoringIds] = React.useState<Set<string>>(new Set());
  const [roomName, setRoomName] = React.useState<string>('');

  const fetchTrash = React.useCallback(async () => {
    try {
      const [trashResponse, roomResponse] = await Promise.all([
        fetch(`/api/rooms/${roomId}/trash`),
        fetch(`/api/rooms/${roomId}`),
      ]);

      if (trashResponse.ok) {
        const data = await trashResponse.json();
        setTrashData(data);
      }

      if (roomResponse.ok) {
        const roomData = await roomResponse.json();
        setRoomName(roomData.room?.name || 'Room');
      }
    } catch (error) {
      console.error('Failed to fetch trash:', error);
    } finally {
      setIsLoading(false);
    }
  }, [roomId]);

  React.useEffect(() => {
    fetchTrash();
  }, [fetchTrash]);

  const handleRestore = async (documentId: string) => {
    setRestoringIds((prev) => new Set(prev).add(documentId));
    try {
      const response = await fetch(`/api/rooms/${roomId}/documents/${documentId}/restore`, {
        method: 'POST',
      });

      if (response.ok) {
        setTrashData((prev) =>
          prev
            ? {
                ...prev,
                documents: prev.documents.filter((doc) => doc.id !== documentId),
              }
            : null
        );
      }
    } catch (error) {
      console.error('Failed to restore document:', error);
    } finally {
      setRestoringIds((prev) => {
        const next = new Set(prev);
        next.delete(documentId);
        return next;
      });
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('folder')) {
      return <FolderOpen className="h-5 w-5 text-neutral-500" />;
    }
    return <FileText className="h-5 w-5 text-neutral-500" />;
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="mb-8 h-4 w-96" />
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Trash"
        description={`Documents deleted within the last ${trashData?.retentionDays ?? 30} days`}
        breadcrumbs={[
          { label: 'Rooms', href: '/rooms' },
          { label: roomName, href: `/rooms/${roomId}` },
          { label: 'Trash' },
        ]}
        actions={
          <Button variant="outline" onClick={() => router.push(`/rooms/${roomId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Room
          </Button>
        }
      />

      <div className="p-6">
        {/* Info Banner */}
        <Card className="mb-6 border-warning-200 bg-warning-50">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-warning-600" />
              <div>
                <p className="text-sm font-medium text-warning-900">
                  Documents are permanently deleted after {trashData?.retentionDays ?? 30} days
                </p>
                <p className="mt-1 text-sm text-warning-700">
                  Restore documents before they are permanently removed. This action cannot be
                  undone.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Deleted Documents */}
        {!trashData || trashData.documents.length === 0 ? (
          <Card className="p-12 text-center">
            <Trash2 className="mx-auto mb-4 h-12 w-12 text-neutral-400" />
            <h3 className="mb-2 text-lg font-semibold text-neutral-900">Trash is empty</h3>
            <p className="mx-auto max-w-sm text-neutral-500">
              Deleted documents will appear here. They can be restored within{' '}
              {trashData?.retentionDays ?? 30} days.
            </p>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100">
                  <Trash2 className="h-5 w-5 text-neutral-600" />
                </div>
                <div>
                  <CardTitle>Deleted Documents</CardTitle>
                  <CardDescription>
                    {trashData.documents.length} document{trashData.documents.length !== 1 && 's'}{' '}
                    in trash
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {trashData.documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-neutral-50"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100">
                      {getFileIcon(doc.mimeType)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{doc.name}</p>
                      <div className="mt-1 flex items-center gap-3 text-xs text-neutral-500">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Deleted {formatDate(doc.deletedAt)}
                        </span>
                        {doc.folder && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <FolderOpen className="h-3 w-3" />
                              {doc.folder.name}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={doc.daysUntilPermanentDeletion <= 3 ? 'danger' : 'secondary'}
                        className="whitespace-nowrap"
                      >
                        {doc.daysUntilPermanentDeletion === 0
                          ? 'Deletes today'
                          : `${doc.daysUntilPermanentDeletion} day${doc.daysUntilPermanentDeletion !== 1 ? 's' : ''} left`}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRestore(doc.id)}
                        disabled={restoringIds.has(doc.id)}
                      >
                        <RotateCcw className="mr-1 h-4 w-4" />
                        {restoringIds.has(doc.id) ? 'Restoring...' : 'Restore'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
