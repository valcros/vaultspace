'use client';

import * as React from 'react';
import {
  MessageSquare,
  Plus,
  Send,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  FileText,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';

interface Answer {
  id: string;
  body: string;
  createdAt: string;
  answeredBy: { firstName: string; lastName: string; email: string } | null;
}

interface Question {
  id: string;
  subject: string;
  body: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  priority: 'NORMAL' | 'HIGH' | 'URGENT';
  isPublic: boolean;
  documentId: string | null;
  documentName?: string | null;
  createdAt: string;
  askedBy: { firstName: string; lastName: string; email: string } | null;
  answers: Answer[];
}

type StatusFilter = 'ALL' | 'OPEN' | 'ANSWERED' | 'CLOSED';

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusBadge(status: Question['status']) {
  switch (status) {
    case 'OPEN':
      return (
        <Badge variant="outline" className="border-yellow-300 bg-yellow-50 text-yellow-700">
          <Clock className="mr-1 h-3 w-3" />
          Open
        </Badge>
      );
    case 'ANSWERED':
      return (
        <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">
          <CheckCircle className="mr-1 h-3 w-3" />
          Answered
        </Badge>
      );
    case 'CLOSED':
      return (
        <Badge variant="outline" className="border-neutral-300 bg-neutral-50 text-neutral-500">
          <XCircle className="mr-1 h-3 w-3" />
          Closed
        </Badge>
      );
  }
}

function priorityBadge(priority: Question['priority']) {
  if (priority === 'HIGH') {
    return (
      <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-700">
        <AlertCircle className="mr-1 h-3 w-3" />
        High
      </Badge>
    );
  }
  if (priority === 'URGENT') {
    return (
      <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">
        <AlertCircle className="mr-1 h-3 w-3" />
        Urgent
      </Badge>
    );
  }
  return null;
}

export function QATab({ roomId }: { roomId: string }) {
  const [questions, setQuestions] = React.useState<Question[]>([]);
  const [selectedQuestion, setSelectedQuestion] = React.useState<Question | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('ALL');

  const [showNewQuestionDialog, setShowNewQuestionDialog] = React.useState(false);
  const [showQuestionDetail, setShowQuestionDetail] = React.useState(false);

  // New question form
  const [newSubject, setNewSubject] = React.useState('');
  const [newBody, setNewBody] = React.useState('');
  const [newDocumentId, setNewDocumentId] = React.useState('');
  const [newPriority, setNewPriority] = React.useState<'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL');
  const [newIsPublic, setNewIsPublic] = React.useState(true);
  const [isSubmittingQuestion, setIsSubmittingQuestion] = React.useState(false);

  // Answer form
  const [newAnswerBody, setNewAnswerBody] = React.useState('');
  const [isSubmittingAnswer, setIsSubmittingAnswer] = React.useState(false);

  const fetchQuestions = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (statusFilter !== 'ALL') {
        params.set('status', statusFilter);
      }
      const res = await fetch(`/api/rooms/${roomId}/questions?${params.toString()}`);
      if (!res.ok) {
        throw new Error('Failed to fetch questions');
      }
      const data = await res.json();
      setQuestions(data.questions ?? data);
    } catch {
      toast({ title: 'Error', description: 'Failed to load questions', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [roomId, statusFilter]);

  React.useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const handleCreateQuestion = async () => {
    if (!newSubject.trim() || !newBody.trim()) {
      return;
    }
    setIsSubmittingQuestion(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: newSubject.trim(),
          body: newBody.trim(),
          documentId: newDocumentId.trim() || null,
          priority: newPriority,
          isPublic: newIsPublic,
        }),
      });
      if (!res.ok) {
        throw new Error('Failed to create question');
      }
      toast({ title: 'Question submitted' });
      setShowNewQuestionDialog(false);
      setNewSubject('');
      setNewBody('');
      setNewDocumentId('');
      setNewPriority('NORMAL');
      setNewIsPublic(true);
      fetchQuestions();
    } catch {
      toast({ title: 'Error', description: 'Failed to submit question', variant: 'destructive' });
    } finally {
      setIsSubmittingQuestion(false);
    }
  };

  const handleUpdateQuestion = async (
    questionId: string,
    updates: Partial<Pick<Question, 'status' | 'priority' | 'isPublic'>>
  ) => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/questions/${questionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        throw new Error('Failed to update question');
      }
      const updated = await res.json();
      setQuestions((prev) => prev.map((q) => (q.id === questionId ? { ...q, ...updated } : q)));
      if (selectedQuestion?.id === questionId) {
        setSelectedQuestion((prev) => (prev ? { ...prev, ...updated } : prev));
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update question', variant: 'destructive' });
    }
  };

  const handleSubmitAnswer = async () => {
    if (!selectedQuestion || !newAnswerBody.trim()) {
      return;
    }
    setIsSubmittingAnswer(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/questions/${selectedQuestion.id}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: newAnswerBody.trim() }),
      });
      if (!res.ok) {
        throw new Error('Failed to submit answer');
      }
      const answer = await res.json();
      setSelectedQuestion((prev) =>
        prev ? { ...prev, answers: [...prev.answers, answer] } : prev
      );
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === selectedQuestion.id ? { ...q, answers: [...q.answers, answer] } : q
        )
      );
      setNewAnswerBody('');
      toast({ title: 'Answer submitted' });
    } catch {
      toast({ title: 'Error', description: 'Failed to submit answer', variant: 'destructive' });
    } finally {
      setIsSubmittingAnswer(false);
    }
  };

  const openDetail = (question: Question) => {
    setSelectedQuestion(question);
    setShowQuestionDetail(true);
    setNewAnswerBody('');
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Questions ({questions.length})</h3>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="ANSWERED">Answered</SelectItem>
              <SelectItem value="CLOSED">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setShowNewQuestionDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Ask Question
          </Button>
        </div>
      </div>

      {/* Question List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : questions.length === 0 ? (
        <Card className="p-8 text-center">
          <MessageSquare className="mx-auto mb-3 h-10 w-10 text-neutral-400" />
          <h3 className="mb-1 text-base font-semibold text-neutral-900">No questions yet</h3>
          <p className="mx-auto max-w-sm text-sm text-neutral-500">
            Ask a question to start a Q&amp;A thread in this room.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {questions.map((q) => (
            <Card
              key={q.id}
              className="cursor-pointer p-4 transition-colors hover:bg-neutral-50"
              onClick={() => openDetail(q)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="truncate font-semibold text-neutral-900">{q.subject}</span>
                    {statusBadge(q.status)}
                    {priorityBadge(q.priority)}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-neutral-500">
                    <span>
                      {q.askedBy ? `${q.askedBy.firstName} ${q.askedBy.lastName}` : 'Unknown'}
                    </span>
                    <span>{timeAgo(q.createdAt)}</span>
                    {q.documentName && (
                      <span className="flex items-center gap-1 text-blue-600">
                        <FileText className="h-3 w-3" />
                        {q.documentName}
                      </span>
                    )}
                  </div>
                </div>
                <span className="whitespace-nowrap text-xs text-neutral-500">
                  {q.answers.length} {q.answers.length === 1 ? 'answer' : 'answers'}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Question Detail Dialog */}
      <Dialog open={showQuestionDetail} onOpenChange={setShowQuestionDetail}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          {selectedQuestion && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedQuestion.subject}</DialogTitle>
                <DialogDescription>
                  Asked by{' '}
                  {selectedQuestion.askedBy
                    ? `${selectedQuestion.askedBy.firstName} ${selectedQuestion.askedBy.lastName} (${selectedQuestion.askedBy.email})`
                    : 'Unknown'}{' '}
                  &middot; {timeAgo(selectedQuestion.createdAt)}
                </DialogDescription>
              </DialogHeader>

              {/* Question body */}
              <div className="mt-2 whitespace-pre-wrap rounded-md bg-neutral-50 p-4 text-sm text-neutral-800">
                {selectedQuestion.body}
              </div>

              {/* Controls */}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Status</Label>
                  <Select
                    value={selectedQuestion.status}
                    onValueChange={(v) =>
                      handleUpdateQuestion(selectedQuestion.id, {
                        status: v as Question['status'],
                      })
                    }
                  >
                    <SelectTrigger className="h-8 w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OPEN">Open</SelectItem>
                      <SelectItem value="ANSWERED">Answered</SelectItem>
                      <SelectItem value="CLOSED">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Priority</Label>
                  <Select
                    value={selectedQuestion.priority}
                    onValueChange={(v) =>
                      handleUpdateQuestion(selectedQuestion.id, {
                        priority: v as Question['priority'],
                      })
                    }
                  >
                    <SelectTrigger className="h-8 w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NORMAL">Normal</SelectItem>
                      <SelectItem value="HIGH">High</SelectItem>
                      <SelectItem value="URGENT">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selectedQuestion.isPublic}
                    onChange={(e) =>
                      handleUpdateQuestion(selectedQuestion.id, { isPublic: e.target.checked })
                    }
                    className="rounded border-neutral-300"
                  />
                  Public
                </label>
              </div>

              {/* Linked document */}
              {selectedQuestion.documentName && (
                <div className="mt-2 flex items-center gap-1 text-xs text-blue-600">
                  <FileText className="h-3 w-3" />
                  Linked to: {selectedQuestion.documentName}
                </div>
              )}

              {/* Answers */}
              <div className="mt-4 space-y-3">
                <h4 className="text-sm font-semibold text-neutral-700">
                  Answers ({selectedQuestion.answers.length})
                </h4>
                {selectedQuestion.answers.length === 0 ? (
                  <p className="text-sm text-neutral-500">No answers yet.</p>
                ) : (
                  selectedQuestion.answers.map((a) => (
                    <div key={a.id} className="rounded-md border border-neutral-200 bg-white p-3">
                      <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
                        <span className="font-medium text-neutral-700">
                          {a.answeredBy
                            ? `${a.answeredBy.firstName} ${a.answeredBy.lastName}`
                            : 'Unknown'}
                        </span>
                        <span>{timeAgo(a.createdAt)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-neutral-800">{a.body}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Answer composition */}
              <div className="mt-4 space-y-2">
                <Label htmlFor="answer-body" className="text-sm font-medium">
                  Your Answer
                </Label>
                <textarea
                  id="answer-body"
                  className="w-full rounded-md border border-neutral-300 p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows={3}
                  placeholder="Write your answer..."
                  value={newAnswerBody}
                  onChange={(e) => setNewAnswerBody(e.target.value)}
                />
                <div className="flex justify-end">
                  <Button
                    onClick={handleSubmitAnswer}
                    disabled={!newAnswerBody.trim() || isSubmittingAnswer}
                  >
                    {isSubmittingAnswer ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Submit Answer
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* New Question Dialog */}
      <Dialog open={showNewQuestionDialog} onOpenChange={setShowNewQuestionDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ask a Question</DialogTitle>
            <DialogDescription>
              Submit a question for the room administrators to answer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="q-subject">Subject</Label>
              <Input
                id="q-subject"
                placeholder="Question subject"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-body">Details</Label>
              <textarea
                id="q-body"
                className="w-full rounded-md border border-neutral-300 p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                rows={4}
                placeholder="Describe your question in detail..."
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-docid">Document ID (optional)</Label>
              <Input
                id="q-docid"
                placeholder="Link to a specific document"
                value={newDocumentId}
                onChange={(e) => setNewDocumentId(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-4">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={newPriority}
                  onValueChange={(v) => setNewPriority(v as 'NORMAL' | 'HIGH' | 'URGENT')}
                >
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NORMAL">Normal</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 pt-6 text-sm">
                <input
                  type="checkbox"
                  checked={newIsPublic}
                  onChange={(e) => setNewIsPublic(e.target.checked)}
                  className="rounded border-neutral-300"
                />
                Public question
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewQuestionDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateQuestion}
              disabled={!newSubject.trim() || !newBody.trim() || isSubmittingQuestion}
            >
              {isSubmittingQuestion && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
