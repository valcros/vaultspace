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
      return <FolderOpen className="w-5 h-5 text-neutral-500" />;
    }
    return <FileText className="w-5 h-5 text-neutral-500" />;
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-4 w-96 mb-8" />
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
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Room
          </Button>
        }
      />

      <div className="p-6">
        {/* Info Banner */}
        <Card className="mb-6 border-warning-200 bg-warning-50">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-warning-900">
                  Documents are permanently deleted after {trashData?.retentionDays ?? 30} days
                </p>
                <p className="text-sm text-warning-700 mt-1">
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
            <Trash2 className="w-12 h-12 mx-auto text-neutral-400 mb-4" />
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">Trash is empty</h3>
            <p className="text-neutral-500 max-w-sm mx-auto">
              Deleted documents will appear here. They can be restored within{' '}
              {trashData?.retentionDays ?? 30} days.
            </p>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-neutral-100 flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-neutral-600" />
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
                    className="flex items-center gap-4 p-4 border rounded-lg hover:bg-neutral-50 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-lg bg-neutral-100 flex items-center justify-center">
                      {getFileIcon(doc.mimeType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{doc.name}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-neutral-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Deleted {formatDate(doc.deletedAt)}
                        </span>
                        {doc.folder && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <FolderOpen className="w-3 h-3" />
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
                        <RotateCcw className="w-4 h-4 mr-1" />
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
