'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  MessageSquarePlus,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  MessageCircle,
  Clock,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { ViewerShell } from '@/components/layout/viewer-shell';

interface ViewerSession {
  roomName: string;
  organizationName: string;
  organizationLogo: string | null;
  downloadEnabled: boolean;
  watermarkEnabled: boolean;
}

interface Answer {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
}

interface Question {
  id: string;
  subject: string;
  body: string;
  status: 'pending' | 'answered' | 'rejected' | 'closed';
  isPublic: boolean;
  createdAt: string;
  answers: Answer[];
}

const statusVariantMap: Record<Question['status'], 'secondary' | 'success' | 'danger' | 'outline'> =
  {
    pending: 'secondary',
    answered: 'success',
    rejected: 'danger',
    closed: 'outline',
  };

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) {
    return 'just now';
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}d ago`;
  }
  return date.toLocaleDateString();
}

export default function ViewerQuestionsPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const shareToken = params['shareToken'] as string;

  const [session, setSession] = React.useState<ViewerSession | null>(null);
  const [ownQuestions, setOwnQuestions] = React.useState<Question[]>([]);
  const [publicQuestions, setPublicQuestions] = React.useState<Question[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());

  // Ask question dialog state
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const fetchQuestions = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/view/${shareToken}/questions`);
      const data = await response.json();

      if (!response.ok) {
        router.push(`/view/${shareToken}`);
        return;
      }

      setSession(data.session);
      setOwnQuestions(data.own || []);
      setPublicQuestions(data.public || []);
    } catch (error) {
      console.error('Failed to fetch questions:', error);
      router.push(`/view/${shareToken}`);
    } finally {
      setIsLoading(false);
    }
  }, [shareToken, router]);

  React.useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!subject.trim() || !body.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/view/${shareToken}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        toast({
          title: 'Error',
          description: data.error || 'Failed to submit question',
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Question submitted',
        description: 'Your question has been sent to the room administrators.',
      });
      setSubject('');
      setBody('');
      setDialogOpen(false);
      fetchQuestions();
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to submit question. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = () => {
    fetch(`/api/view/${shareToken}/logout`, { method: 'POST' }).finally(() =>
      router.push(`/view/${shareToken}`)
    );
  };

  if (isLoading && !session) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef3ff_46%,#f8fafc_100%)] px-4 py-8 dark:bg-[linear-gradient(180deg,#020617_0%,#0f172a_40%,#111827_100%)]">
        <div className="mx-auto max-w-6xl space-y-6">
          <Skeleton className="h-20 w-full rounded-[1.75rem]" />
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-[1.25rem]" />
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
      activeSection="questions"
      onExit={handleLogout}
    >
      {/* Top bar with back link and ask button */}
      <div className="bg-white/88 mb-6 rounded-[1.5rem] border border-slate-200/80 p-4 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.35)] ring-1 ring-white/50 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/75 dark:ring-white/5">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => router.push(`/view/${shareToken}/documents`)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Documents
          </button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <MessageSquarePlus className="mr-2 h-4 w-4" />
            Ask a Question
          </Button>
        </div>
      </div>

      {/* Your Questions */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-slate-950 dark:text-white">
          Your Questions
        </h2>
        {ownQuestions.length === 0 ? (
          <Card className="bg-white/88 rounded-[1.5rem] border-slate-200/80 p-8 text-center shadow-[0_20px_42px_-34px_rgba(15,23,42,0.35)] ring-1 ring-white/50 dark:border-slate-800 dark:bg-slate-950/75 dark:ring-white/5">
            <MessageCircle className="mx-auto mb-3 h-10 w-10 text-slate-400 dark:text-slate-500" />
            <p className="text-slate-500 dark:text-slate-400">
              You haven&apos;t asked any questions yet.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {ownQuestions.map((q) => {
              const isExpanded = expandedIds.has(q.id);
              return (
                <Card
                  key={q.id}
                  className="bg-white/88 overflow-hidden rounded-[1.25rem] border-slate-200/80 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.35)] ring-1 ring-white/50 dark:border-slate-800 dark:bg-slate-950/75 dark:ring-white/5"
                >
                  <button
                    className="flex w-full items-center gap-3 p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-900/45"
                    onClick={() => toggleExpanded(q.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400 dark:text-slate-500" />
                    ) : (
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400 dark:text-slate-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-slate-950 dark:text-white">
                          {q.subject}
                        </span>
                        <Badge variant={statusVariantMap[q.status]}>{q.status}</Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatRelativeTime(q.createdAt)}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageCircle className="h-3 w-3" />
                          {q.answers.length} {q.answers.length === 1 ? 'answer' : 'answers'}
                        </span>
                      </div>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-slate-200/80 bg-slate-50/70 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/45">
                      <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">
                        {q.body}
                      </p>
                      {q.answers.length > 0 && (
                        <div className="mt-4 space-y-3">
                          {q.answers.map((a) => (
                            <div
                              key={a.id}
                              className="rounded-xl border border-slate-200/80 bg-white p-3 dark:border-slate-700 dark:bg-slate-950/60"
                            >
                              <div className="mb-1 flex items-center justify-between">
                                <span className="text-sm font-medium text-slate-950 dark:text-white">
                                  {a.authorName}
                                </span>
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                  {formatRelativeTime(a.createdAt)}
                                </span>
                              </div>
                              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">
                                {a.body}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Public Q&A */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-950 dark:text-white">
          Public Q&amp;A
        </h2>
        {publicQuestions.length === 0 ? (
          <Card className="bg-white/88 rounded-[1.5rem] border-slate-200/80 p-8 text-center shadow-[0_20px_42px_-34px_rgba(15,23,42,0.35)] ring-1 ring-white/50 dark:border-slate-800 dark:bg-slate-950/75 dark:ring-white/5">
            <MessageCircle className="mx-auto mb-3 h-10 w-10 text-slate-400 dark:text-slate-500" />
            <p className="text-slate-500 dark:text-slate-400">
              No public questions and answers yet.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {publicQuestions.map((q) => {
              const isExpanded = expandedIds.has(`public-${q.id}`);
              return (
                <Card
                  key={q.id}
                  className="bg-white/88 overflow-hidden rounded-[1.25rem] border-slate-200/80 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.35)] ring-1 ring-white/50 dark:border-slate-800 dark:bg-slate-950/75 dark:ring-white/5"
                >
                  <button
                    className="flex w-full items-center gap-3 p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-900/45"
                    onClick={() => toggleExpanded(`public-${q.id}`)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400 dark:text-slate-500" />
                    ) : (
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400 dark:text-slate-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="truncate font-medium text-slate-950 dark:text-white">
                        {q.subject}
                      </span>
                      <div className="mt-1 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatRelativeTime(q.createdAt)}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageCircle className="h-3 w-3" />
                          {q.answers.length} {q.answers.length === 1 ? 'answer' : 'answers'}
                        </span>
                      </div>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-slate-200/80 bg-slate-50/70 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/45">
                      <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">
                        {q.body}
                      </p>
                      {q.answers.length > 0 && (
                        <div className="mt-4 space-y-3">
                          {q.answers.map((a) => (
                            <div
                              key={a.id}
                              className="rounded-xl border border-slate-200/80 bg-white p-3 dark:border-slate-700 dark:bg-slate-950/60"
                            >
                              <div className="mb-1 flex items-center justify-between">
                                <span className="text-sm font-medium text-slate-950 dark:text-white">
                                  {a.authorName}
                                </span>
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                  {formatRelativeTime(a.createdAt)}
                                </span>
                              </div>
                              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">
                                {a.body}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>
      {/* Ask Question Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask a Question</DialogTitle>
            <DialogDescription>
              Submit a question to the room administrators. You will be notified when they respond.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="question-subject" required>
                Subject
              </Label>
              <Input
                id="question-subject"
                placeholder="Brief summary of your question"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="question-body" required>
                Details
              </Label>
              <Textarea
                id="question-body"
                placeholder="Provide additional details about your question..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="mt-1.5"
                rows={5}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !subject.trim() || !body.trim()}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Question'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ViewerShell>
  );
}
