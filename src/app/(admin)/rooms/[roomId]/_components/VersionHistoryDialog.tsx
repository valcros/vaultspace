'use client';

import * as React from 'react';
import { FileText, Upload, Eye, History, RotateCcw, Loader2, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';

interface DocumentVersionInfo {
  id: string;
  versionNumber: number;
  fileName: string;
  fileSize: string;
  mimeType: string;
  changeDescription: string | null;
  scanStatus: string;
  previewStatus: string;
  createdAt: string;
  uploadedByUser: { firstName: string; lastName: string; email: string } | null;
}

/** The subset of the room page's Document shape the version history reads. */
export interface VersionHistoryDocument {
  id: string;
  name: string;
}

export interface VersionHistoryDialogProps {
  open: boolean;
  roomId: string;
  /** Document whose history is shown; set by the page before opening. */
  doc: VersionHistoryDocument | null;
  /** Closes the dialog (page clears showVersionDialog + versionDoc). */
  onClose: () => void;
  /** Refreshes the page's document list after rollback / new version. */
  onDocumentsRefresh: () => void;
}

export function VersionHistoryDialog({
  open,
  roomId,
  doc,
  onClose,
  onDocumentsRefresh,
}: VersionHistoryDialogProps) {
  const [versions, setVersions] = React.useState<DocumentVersionInfo[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = React.useState(false);
  const [isRollingBack, setIsRollingBack] = React.useState(false);
  const [isUploadingVersion, setIsUploadingVersion] = React.useState(false);
  const [versionPreviewUrl, setVersionPreviewUrl] = React.useState<string | null>(null);
  const [versionPreviewId, setVersionPreviewId] = React.useState<string | null>(null);
  const versionFileRef = React.useRef<HTMLInputElement>(null);

  // Same fetch the page-level handleShowVersions used to run on open and
  // after rollback / new-version uploads.
  const loadVersions = React.useCallback(async () => {
    if (!doc) {
      return;
    }
    setIsLoadingVersions(true);
    setVersionPreviewUrl(null);
    setVersionPreviewId(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/documents/${doc.id}/versions`);
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions || []);
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load versions', variant: 'destructive' });
    } finally {
      setIsLoadingVersions(false);
    }
  }, [roomId, doc]);

  React.useEffect(() => {
    if (open && doc) {
      loadVersions();
    }
  }, [open, doc, loadVersions]);

  const handleClose = React.useCallback(() => {
    setVersions([]);
    setVersionPreviewUrl(null);
    setVersionPreviewId(null);
    onClose();
  }, [onClose]);

  const handleRollback = React.useCallback(
    async (versionId: string, versionNumber: number) => {
      if (!doc) {
        return;
      }
      setIsRollingBack(true);
      try {
        const res = await fetch(
          `/api/rooms/${roomId}/documents/${doc.id}/versions/${versionId}/rollback`,
          { method: 'POST' }
        );
        if (res.ok) {
          toast({ title: 'Rolled back', description: `Restored to version ${versionNumber}` });
          onDocumentsRefresh();
          loadVersions();
        } else {
          const data = await res.json();
          toast({
            title: 'Rollback failed',
            description: data.error?.message || 'Could not rollback',
            variant: 'destructive',
          });
        }
      } catch {
        toast({
          title: 'Error',
          description: 'Failed to rollback version',
          variant: 'destructive',
        });
      } finally {
        setIsRollingBack(false);
      }
    },
    [roomId, doc, onDocumentsRefresh, loadVersions]
  );

  const handleUploadNewVersion = React.useCallback(
    async (file: File) => {
      if (!doc) {
        return;
      }
      setIsUploadingVersion(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`/api/rooms/${roomId}/documents/${doc.id}/versions`, {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          toast({ title: 'Version uploaded', description: 'New version uploaded successfully' });
          onDocumentsRefresh();
          loadVersions();
        } else {
          const data = await res.json();
          toast({
            title: 'Upload failed',
            description: data.error?.message || 'Could not upload version',
            variant: 'destructive',
          });
        }
      } catch {
        toast({
          title: 'Error',
          description: 'Failed to upload new version',
          variant: 'destructive',
        });
      } finally {
        setIsUploadingVersion(false);
      }
    },
    [roomId, doc, onDocumentsRefresh, loadVersions]
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleClose();
        }
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Version History
          </DialogTitle>
          <DialogDescription>
            {doc?.name} — {versions.length} version{versions.length !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto">
          {isLoadingVersions ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
              <span className="ml-2 text-neutral-500">Loading versions...</span>
            </div>
          ) : versions.length === 0 ? (
            <div className="py-8 text-center text-neutral-500">No versions found</div>
          ) : (
            <div className="space-y-2">
              {versions.map((v, i) => {
                const isCurrent = i === 0;
                // CLEAN or SKIPPED (allowed-but-unscanned) versions are viewable.
                const isViewable = v.scanStatus === 'CLEAN' || v.scanStatus === 'SKIPPED';
                const fileSizeKb = Number(v.fileSize) / 1024;
                const fileSizeDisplay =
                  fileSizeKb > 1024
                    ? `${(fileSizeKb / 1024).toFixed(1)} MB`
                    : `${fileSizeKb.toFixed(0)} KB`;

                return (
                  <div
                    key={v.id}
                    className={`rounded-lg border p-3 ${isCurrent ? 'border-primary-200 bg-primary-50/50' : 'bg-white'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">v{v.versionNumber}</span>
                          {isCurrent && (
                            <Badge variant="default" className="text-xs">
                              Current
                            </Badge>
                          )}
                          {v.scanStatus === 'INFECTED' && (
                            <Badge variant="danger" className="text-xs">
                              <AlertCircle className="mr-1 h-3 w-3" />
                              Infected
                            </Badge>
                          )}
                          {v.scanStatus === 'PENDING' && (
                            <Badge variant="secondary" className="text-xs">
                              Scanning...
                            </Badge>
                          )}
                          {v.scanStatus === 'SKIPPED' && (
                            <Badge variant="secondary" className="text-xs">
                              <AlertCircle className="mr-1 h-3 w-3" />
                              Not scanned
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-neutral-500">
                          {v.uploadedByUser
                            ? `${v.uploadedByUser.firstName} ${v.uploadedByUser.lastName}`
                            : 'Unknown'}{' '}
                          — {new Date(v.createdAt).toLocaleString()}
                        </p>
                        <p className="text-xs text-neutral-400">
                          {v.fileName} · {fileSizeDisplay}
                        </p>
                        {v.changeDescription && (
                          <p className="mt-1 text-xs italic text-neutral-600">
                            {v.changeDescription}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {isViewable && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              if (versionPreviewId === v.id) {
                                setVersionPreviewUrl(null);
                                setVersionPreviewId(null);
                              } else {
                                setVersionPreviewUrl(
                                  `/api/rooms/${roomId}/documents/${doc!.id}/preview?versionId=${v.id}`
                                );
                                setVersionPreviewId(v.id);
                              }
                            }}
                          >
                            <Eye className="mr-1 h-3 w-3" />
                            {versionPreviewId === v.id ? 'Hide' : 'Preview'}
                          </Button>
                        )}
                        {!isCurrent && isViewable && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={isRollingBack}
                            onClick={() => handleRollback(v.id, v.versionNumber)}
                          >
                            {isRollingBack ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <RotateCcw className="mr-1 h-3 w-3" />
                            )}
                            Restore
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Inline preview for selected version */}
                    {versionPreviewId === v.id && versionPreviewUrl && (
                      <div className="mt-3 overflow-hidden rounded-lg border bg-neutral-50">
                        <div className="h-64">
                          {v.mimeType === 'application/pdf' ? (
                            <iframe
                              src={versionPreviewUrl}
                              className="h-full w-full border-0"
                              title={`v${v.versionNumber} preview`}
                            />
                          ) : v.mimeType.startsWith('image/') ? (
                            <div className="flex h-full items-center justify-center">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={versionPreviewUrl}
                                alt={`v${v.versionNumber}`}
                                className="max-h-full max-w-full object-contain"
                              />
                            </div>
                          ) : (
                            <div className="flex h-full items-center justify-center text-neutral-400">
                              <FileText className="mr-2 h-5 w-5" />
                              Preview loaded in new format
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <div>
            <input
              ref={versionFileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleUploadNewVersion(file);
                }
                e.target.value = '';
              }}
            />
            <Button
              variant="outline"
              onClick={() => versionFileRef.current?.click()}
              disabled={isUploadingVersion}
            >
              {isUploadingVersion ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Upload New Version
            </Button>
          </div>
          <Button onClick={handleClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
