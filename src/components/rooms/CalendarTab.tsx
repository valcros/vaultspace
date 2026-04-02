'use client';

import * as React from 'react';
import { Calendar, Plus, Trash2, Clock, FileText, Loader2 } from 'lucide-react';
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

type CalendarEventType = 'MILESTONE' | 'REVIEW_DATE' | 'DEADLINE' | 'MEETING' | 'OTHER';

interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  eventType: CalendarEventType;
  date: string;
  endDate: string | null;
  isAllDay: boolean;
  color: string | null;
  documentId: string | null;
  createdAt: string;
  createdBy: { firstName: string; lastName: string } | null;
  document: { id: string; name: string } | null;
}

const EVENT_TYPE_COLORS: Record<CalendarEventType, string> = {
  MILESTONE: 'border-l-purple-500',
  REVIEW_DATE: 'border-l-blue-500',
  DEADLINE: 'border-l-red-500',
  MEETING: 'border-l-green-500',
  OTHER: 'border-l-gray-400',
};

const EVENT_TYPE_BADGE_STYLES: Record<CalendarEventType, string> = {
  MILESTONE: 'border-purple-300 bg-purple-50 text-purple-700',
  REVIEW_DATE: 'border-blue-300 bg-blue-50 text-blue-700',
  DEADLINE: 'border-red-300 bg-red-50 text-red-700',
  MEETING: 'border-green-300 bg-green-50 text-green-700',
  OTHER: 'border-neutral-300 bg-neutral-50 text-neutral-500',
};

const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  MILESTONE: 'Milestone',
  REVIEW_DATE: 'Review Date',
  DEADLINE: 'Deadline',
  MEETING: 'Meeting',
  OTHER: 'Other',
};

function formatEventDate(dateStr: string, isAllDay: boolean): string {
  const d = new Date(dateStr);
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };
  if (!isAllDay) {
    options.hour = 'numeric';
    options.minute = '2-digit';
  }
  return d.toLocaleDateString('en-US', options);
}

function getMonthKey(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function CalendarTab({ roomId }: { roomId: string }) {
  const [events, setEvents] = React.useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [showNewEventDialog, setShowNewEventDialog] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  // New event form state
  const [newTitle, setNewTitle] = React.useState('');
  const [newDescription, setNewDescription] = React.useState('');
  const [newDate, setNewDate] = React.useState('');
  const [newTime, setNewTime] = React.useState('09:00');
  const [newIsAllDay, setNewIsAllDay] = React.useState(true);
  const [newEventType, setNewEventType] = React.useState<CalendarEventType>('OTHER');
  const [newColor, setNewColor] = React.useState('');
  const [newDocumentId, setNewDocumentId] = React.useState('');

  const fetchEvents = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/calendar`);
      if (!res.ok) {
        throw new Error('Failed to fetch events');
      }
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to load calendar events',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [roomId]);

  React.useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleCreateEvent = async () => {
    if (!newTitle.trim() || !newDate) {
      return;
    }
    setIsSubmitting(true);
    try {
      let isoDate = new Date(newDate + 'T00:00:00').toISOString();
      if (!newIsAllDay && newTime) {
        isoDate = new Date(newDate + 'T' + newTime + ':00').toISOString();
      }

      const res = await fetch(`/api/rooms/${roomId}/calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDescription.trim() || undefined,
          date: isoDate,
          isAllDay: newIsAllDay,
          eventType: newEventType,
          color: newColor.trim() || undefined,
          documentId: newDocumentId.trim() || null,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to create event');
      }

      toast({ title: 'Event created' });
      setShowNewEventDialog(false);
      resetForm();
      fetchEvents();
    } catch {
      toast({ title: 'Error', description: 'Failed to create event', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    setDeletingId(eventId);
    try {
      const res = await fetch(`/api/rooms/${roomId}/calendar/${eventId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('Failed to delete event');
      }
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
      toast({ title: 'Event deleted' });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete event', variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  const resetForm = () => {
    setNewTitle('');
    setNewDescription('');
    setNewDate('');
    setNewTime('09:00');
    setNewIsAllDay(true);
    setNewEventType('OTHER');
    setNewColor('');
    setNewDocumentId('');
  };

  // Group events by month
  const groupedEvents = React.useMemo(() => {
    const groups: { month: string; events: CalendarEvent[] }[] = [];
    const monthKeys: string[] = [];
    const monthMap: Record<string, CalendarEvent[]> = {};

    for (const event of events) {
      const key = getMonthKey(event.date);
      if (!monthMap[key]) {
        monthMap[key] = [];
        monthKeys.push(key);
      }
      monthMap[key].push(event);
    }

    for (const month of monthKeys) {
      groups.push({ month, events: monthMap[month] ?? [] });
    }

    return groups;
  }, [events]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Calendar</h3>
        <Button onClick={() => setShowNewEventDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Event
        </Button>
      </div>

      {/* Events List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : events.length === 0 ? (
        <Card className="p-8 text-center">
          <Calendar className="mx-auto mb-3 h-10 w-10 text-neutral-400" />
          <h3 className="mb-1 text-base font-semibold text-neutral-900">No events yet</h3>
          <p className="mx-auto max-w-sm text-sm text-neutral-500">
            No events yet — Create calendar events to track milestones and deadlines.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupedEvents.map((group) => (
            <div key={group.month}>
              <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                {group.month}
              </h4>
              <div className="space-y-2">
                {group.events.map((event) => (
                  <Card
                    key={event.id}
                    className={`border-l-4 p-4 ${EVENT_TYPE_COLORS[event.eventType]}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="truncate font-semibold text-neutral-900">
                            {event.title}
                          </span>
                          <Badge
                            variant="outline"
                            className={EVENT_TYPE_BADGE_STYLES[event.eventType]}
                          >
                            {EVENT_TYPE_LABELS[event.eventType]}
                          </Badge>
                        </div>
                        {event.description && (
                          <p className="mb-2 line-clamp-2 text-sm text-neutral-600">
                            {event.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-neutral-500">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatEventDate(event.date, event.isAllDay)}
                          </span>
                          {event.document && (
                            <span className="flex items-center gap-1 text-blue-600">
                              <FileText className="h-3 w-3" />
                              {event.document.name}
                            </span>
                          )}
                          {event.createdBy && (
                            <span>
                              {event.createdBy.firstName} {event.createdBy.lastName}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-neutral-400 hover:text-red-600"
                        onClick={() => handleDeleteEvent(event.id)}
                        disabled={deletingId === event.id}
                      >
                        {deletingId === event.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Event Dialog */}
      <Dialog open={showNewEventDialog} onOpenChange={setShowNewEventDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Calendar Event</DialogTitle>
            <DialogDescription>
              Create a calendar event to track milestones, deadlines, and meetings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="event-title">Title</Label>
              <Input
                id="event-title"
                placeholder="Event title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-description">Description (optional)</Label>
              <textarea
                id="event-description"
                className="w-full rounded-md border border-neutral-300 p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                rows={3}
                placeholder="Event description..."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-4">
              <div className="space-y-2">
                <Label htmlFor="event-date">Date</Label>
                <Input
                  id="event-date"
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 pt-6 text-sm">
                <input
                  type="checkbox"
                  checked={newIsAllDay}
                  onChange={(e) => setNewIsAllDay(e.target.checked)}
                  className="rounded border-neutral-300"
                />
                All day
              </label>
              {!newIsAllDay && (
                <div className="space-y-2">
                  <Label htmlFor="event-time">Time</Label>
                  <Input
                    id="event-time"
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="space-y-2">
                <Label>Event Type</Label>
                <Select
                  value={newEventType}
                  onValueChange={(v) => setNewEventType(v as CalendarEventType)}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MILESTONE">Milestone</SelectItem>
                    <SelectItem value="REVIEW_DATE">Review Date</SelectItem>
                    <SelectItem value="DEADLINE">Deadline</SelectItem>
                    <SelectItem value="MEETING">Meeting</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-color">Color (optional)</Label>
                <Input
                  id="event-color"
                  placeholder="#ff0000"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="w-[120px]"
                  maxLength={7}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-docid">Document ID (optional)</Label>
              <Input
                id="event-docid"
                placeholder="Link to a specific document"
                value={newDocumentId}
                onChange={(e) => setNewDocumentId(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewEventDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateEvent}
              disabled={!newTitle.trim() || !newDate || isSubmitting}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
