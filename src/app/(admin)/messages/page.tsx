'use client';

import * as React from 'react';
import {
  Mail,
  Send,
  Inbox,
  Circle,
  CheckCircle2,
  Loader2,
  FolderOpen,
  FileText,
  ArrowLeft,
} from 'lucide-react';
import { clsx } from 'clsx';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/layout/page-header';
import {
  AdminEmptyState,
  AdminPageContent,
  AdminSurface,
  AdminToolbar,
} from '@/components/layout/admin-page';

// ============================================================================
// Types
// ============================================================================

interface MessageSender {
  id: string;
  email: string;
  name: string;
}

interface MessageContext {
  id: string;
  name: string;
}

interface InboxMessage {
  id: string;
  subject: string;
  body: string;
  sender: MessageSender;
  recipient?: { id: string; email: string; name: string } | null;
  recipientEmail?: string;
  room: MessageContext | null;
  document: MessageContext | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

type ViewMode = 'inbox' | 'sent';

// ============================================================================
// Component
// ============================================================================

export default function MessagesPage() {
  const [viewMode, setViewMode] = React.useState<ViewMode>('inbox');
  const [messages, setMessages] = React.useState<InboxMessage[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedMessage, setSelectedMessage] = React.useState<InboxMessage | null>(null);
  const [composing, setComposing] = React.useState(false);

  // Compose state
  const [recipientEmail, setRecipientEmail] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  const [roomId, setRoomId] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);

  // Fetch messages
  const fetchMessages = React.useCallback(async () => {
    setLoading(true);
    try {
      const endpoint = viewMode === 'inbox' ? '/api/messages/inbox' : '/api/messages';
      const res = await fetch(endpoint);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      setLoading(false);
    }
  }, [viewMode]);

  React.useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Select a message and mark as read
  const handleSelectMessage = async (msg: InboxMessage) => {
    setSelectedMessage(msg);
    setComposing(false);

    if (!msg.isRead && viewMode === 'inbox') {
      try {
        await fetch(`/api/messages/${msg.id}`, { method: 'PATCH' });
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, isRead: true } : m)));
      } catch {
        // Silently fail — non-critical
      }
    }
  };

  // Send a message
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setSendError(null);

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientEmail,
          subject,
          body,
          ...(roomId ? { roomId } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSendError(data.error || 'Failed to send message');
        return;
      }

      // Reset compose form
      setRecipientEmail('');
      setSubject('');
      setBody('');
      setRoomId('');
      setComposing(false);

      // Refresh if on sent view
      if (viewMode === 'sent') {
        fetchMessages();
      }
    } catch {
      setSendError('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const startCompose = () => {
    setSelectedMessage(null);
    setComposing(true);
    setSendError(null);
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHrs = diffMs / (1000 * 60 * 60);

    if (diffHrs < 1) {
      const mins = Math.floor(diffMs / (1000 * 60));
      return `${mins}m ago`;
    }
    if (diffHrs < 24) {
      return `${Math.floor(diffHrs)}h ago`;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <>
      <PageHeader
        title="Messages"
        description="Send and receive private messages"
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Messages' }]}
        actions={
          <Button onClick={startCompose} className="bg-white/20 text-white hover:bg-white/30">
            <Send className="mr-2 h-4 w-4" />
            Compose
          </Button>
        }
      />

      <AdminPageContent>
        <AdminToolbar
          title="Mailbox"
          description="Review conversations, switch between inbox and sent mail, and compose secure messages without leaving the workspace."
          actions={
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {messages.length} {viewMode}
            </div>
          }
        />

        <div
          className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]"
          style={{ minHeight: '600px' }}
        >
          {/* Left: Message List */}
          <div className="min-w-0">
            {/* View Mode Tabs */}
            <div className="mb-3 flex gap-1 rounded-2xl border border-slate-200/80 bg-slate-50/85 p-1.5 dark:border-slate-800 dark:bg-slate-900/70">
              <button
                onClick={() => {
                  setViewMode('inbox');
                  setSelectedMessage(null);
                  setComposing(false);
                }}
                className={clsx(
                  'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  viewMode === 'inbox'
                    ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-950 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                )}
              >
                <Inbox className="h-4 w-4" />
                Inbox
              </button>
              <button
                onClick={() => {
                  setViewMode('sent');
                  setSelectedMessage(null);
                  setComposing(false);
                }}
                className={clsx(
                  'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  viewMode === 'sent'
                    ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-950 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                )}
              >
                <Send className="h-4 w-4" />
                Sent
              </button>
            </div>

            {/* Message List */}
            <AdminSurface className="divide-y divide-slate-200/80 overflow-hidden p-0 dark:divide-slate-800">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              ) : messages.length === 0 ? (
                <div className="py-12 text-center">
                  <Mail className="mx-auto mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" />
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {viewMode === 'inbox' ? 'No messages in your inbox' : 'No sent messages'}
                  </p>
                </div>
              ) : (
                messages.map((msg) => (
                  <button
                    key={msg.id}
                    onClick={() => handleSelectMessage(msg)}
                    className={clsx(
                      'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                      selectedMessage?.id === msg.id
                        ? 'bg-sky-50 dark:bg-sky-950/20'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-900/45',
                      !msg.isRead && viewMode === 'inbox' && 'bg-sky-50/70 dark:bg-sky-950/15'
                    )}
                  >
                    {/* Read indicator */}
                    <div className="mt-1 shrink-0">
                      {!msg.isRead && viewMode === 'inbox' ? (
                        <Circle className="h-2.5 w-2.5 fill-primary-500 text-primary-500" />
                      ) : (
                        <CheckCircle2 className="h-2.5 w-2.5 text-slate-300 dark:text-slate-600" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={clsx(
                            'truncate text-sm',
                            !msg.isRead && viewMode === 'inbox'
                              ? 'font-semibold text-slate-950 dark:text-white'
                              : 'font-medium text-slate-700 dark:text-slate-200'
                          )}
                        >
                          {viewMode === 'inbox'
                            ? msg.sender?.name || 'Unknown'
                            : msg.recipient?.name || msg.recipientEmail || 'Unknown'}
                        </p>
                        <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
                          {formatTime(msg.createdAt)}
                        </span>
                      </div>

                      <p
                        className={clsx(
                          'truncate text-sm',
                          !msg.isRead && viewMode === 'inbox'
                            ? 'font-medium text-slate-800 dark:text-slate-100'
                            : 'text-slate-600 dark:text-slate-300'
                        )}
                      >
                        {msg.subject}
                      </p>

                      {msg.room && (
                        <div className="mt-1 flex items-center gap-1">
                          <FolderOpen className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                          <span className="truncate text-xs text-slate-400 dark:text-slate-500">
                            {msg.room.name}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </AdminSurface>
          </div>

          {/* Right: Detail / Compose */}
          <div className="flex-1">
            {composing ? (
              <AdminSurface className="p-6">
                <div className="mb-4 flex items-center gap-2">
                  <button
                    onClick={() => setComposing(false)}
                    className="rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                    New Message
                  </h2>
                </div>

                <form onSubmit={handleSend} className="space-y-4">
                  <div>
                    <label
                      htmlFor="recipient"
                      className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200"
                    >
                      To
                    </label>
                    <Input
                      id="recipient"
                      type="email"
                      placeholder="recipient@example.com"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="subject"
                      className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200"
                    >
                      Subject
                    </label>
                    <Input
                      id="subject"
                      type="text"
                      placeholder="Message subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      required
                      maxLength={500}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="roomContext"
                      className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200"
                    >
                      Room ID (optional context)
                    </label>
                    <Input
                      id="roomContext"
                      type="text"
                      placeholder="Link to a room (optional)"
                      value={roomId}
                      onChange={(e) => setRoomId(e.target.value)}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="body"
                      className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200"
                    >
                      Message
                    </label>
                    <Textarea
                      id="body"
                      placeholder="Type your message..."
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      required
                      rows={8}
                      className="resize-none"
                    />
                  </div>

                  {sendError && <p className="text-sm text-red-600">{sendError}</p>}

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setComposing(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={sending}>
                      {sending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send className="mr-2 h-4 w-4" />
                          Send Message
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </AdminSurface>
            ) : selectedMessage ? (
              <AdminSurface className="p-6">
                {/* Message Header */}
                <div className="mb-4 border-b border-slate-200/80 pb-4 dark:border-slate-800">
                  <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                    {selectedMessage.subject}
                  </h2>
                  <div className="mt-2 flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                    <span>
                      {viewMode === 'inbox' ? 'From' : 'To'}:{' '}
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        {viewMode === 'inbox'
                          ? selectedMessage.sender?.name || selectedMessage.sender?.email
                          : selectedMessage.recipient?.name || selectedMessage.recipientEmail}
                      </span>
                    </span>
                    <span>
                      {new Date(selectedMessage.createdAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  {/* Context badges */}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedMessage.room && (
                      <Badge variant="secondary" className="flex items-center gap-1">
                        <FolderOpen className="h-3 w-3" />
                        {selectedMessage.room.name}
                      </Badge>
                    )}
                    {selectedMessage.document && (
                      <Badge variant="secondary" className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {selectedMessage.document.name}
                      </Badge>
                    )}
                    {selectedMessage.isRead && (
                      <Badge variant="outline" className="text-green-600 dark:text-green-400">
                        Read
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Message Body */}
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                  {selectedMessage.body}
                </div>
              </AdminSurface>
            ) : (
              <AdminEmptyState
                icon={<Mail className="h-6 w-6" />}
                title="Select a conversation"
                description="Pick a message from the mailbox to read the thread or start a new secure conversation."
              />
            )}
          </div>
        </div>
      </AdminPageContent>
    </>
  );
}
