'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, FileText, FolderOpen, Loader2, Filter, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import {
  AdminEmptyState,
  AdminPageContent,
  AdminSurface,
  AdminToolbar,
} from '@/components/layout/admin-page';

interface SearchResult {
  documentId: string;
  versionId: string;
  title: string;
  fileName: string;
  snippet: string;
  score: number;
  mimeType: string;
  tags: string[];
  uploadedAt: string;
  roomId: string;
  roomName: string;
}

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';

  const [query, setQuery] = React.useState(initialQuery);
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [total, setTotal] = React.useState(0);
  const [took, setTook] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(false);
  const [hasSearched, setHasSearched] = React.useState(false);
  const [offset, setOffset] = React.useState(0);

  // Filters
  const [typeFilter, setTypeFilter] = React.useState<string>('');
  const [showFilters, setShowFilters] = React.useState(false);

  const limit = 20;

  const performSearch = React.useCallback(
    async (q: string, searchOffset: number) => {
      if (!q.trim()) {
        return;
      }
      setIsLoading(true);
      setHasSearched(true);

      try {
        const params = new URLSearchParams({
          q: q.trim(),
          limit: String(limit),
          offset: String(searchOffset),
        });
        if (typeFilter) {
          params.set('type', typeFilter);
        }

        const res = await fetch(`/api/search?${params.toString()}`);
        if (!res.ok) {
          setResults([]);
          setTotal(0);
          return;
        }
        const data = await res.json();
        setResults(data.results || []);
        setTotal(data.total || 0);
        setTook(data.took || 0);
      } catch {
        setResults([]);
        setTotal(0);
      } finally {
        setIsLoading(false);
      }
    },
    [typeFilter]
  );

  // Search on mount if query param exists
  React.useEffect(() => {
    if (initialQuery) {
      performSearch(initialQuery, 0);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
    performSearch(query, 0);
    // Update URL without full navigation
    const params = new URLSearchParams({ q: query });
    window.history.replaceState(null, '', `/search?${params.toString()}`);
  };

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset);
    performSearch(query, newOffset);
    window.scrollTo(0, 0);
  };

  const getMimeTypeLabel = (mimeType: string) => {
    if (mimeType.startsWith('application/pdf')) {
      return 'PDF';
    }
    if (mimeType.startsWith('image/')) {
      return 'Image';
    }
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
      return 'Spreadsheet';
    }
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
      return 'Presentation';
    }
    if (mimeType.includes('document') || mimeType.includes('word')) {
      return 'Document';
    }
    if (mimeType.startsWith('text/')) {
      return 'Text';
    }
    return 'File';
  };

  return (
    <>
      <PageHeader title="Search" breadcrumbs={[{ label: 'Search' }]} />

      <AdminPageContent className="max-w-5xl">
        {/* Search Bar */}
        <form onSubmit={handleSubmit}>
          <AdminToolbar
            title="Search across documents"
            description="Look up file names, extracted text, and tags across your rooms from one indexed search surface."
          >
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search documents by name, content, or tags..."
                  className="h-11 rounded-xl border-slate-200 bg-white pl-10 shadow-sm dark:border-slate-700 dark:bg-slate-950"
                  autoFocus
                />
              </div>
              <Button type="submit" disabled={isLoading || !query.trim()}>
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Search
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowFilters(!showFilters)}>
                <Filter className="h-4 w-4" />
              </Button>
            </div>

            {/* Filters */}
            {showFilters && (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50/85 p-3 dark:border-slate-800 dark:bg-slate-900/70">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Filters:
                </span>
                <Select
                  value={typeFilter}
                  onValueChange={(v) => setTypeFilter(v === 'all' ? '' : v)}
                >
                  <SelectTrigger className="w-44 rounded-xl border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950">
                    <SelectValue placeholder="File type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="application/pdf">PDF</SelectItem>
                    <SelectItem value="image/">Images</SelectItem>
                    <SelectItem value="application/vnd.openxmlformats">Office docs</SelectItem>
                    <SelectItem value="text/">Text files</SelectItem>
                  </SelectContent>
                </Select>
                {typeFilter && (
                  <Button variant="ghost" size="sm" onClick={() => setTypeFilter('')}>
                    <X className="mr-1 h-3 w-3" />
                    Clear
                  </Button>
                )}
              </div>
            )}
          </AdminToolbar>
        </form>

        {/* Results */}
        {isLoading && !hasSearched && (
          <AdminSurface className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </AdminSurface>
        )}

        {isLoading && hasSearched && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
            <span className="ml-2 text-neutral-500">Searching...</span>
          </div>
        )}

        {!isLoading && hasSearched && results.length === 0 && (
          <AdminEmptyState
            icon={<Search className="h-5 w-5" />}
            title="No results found"
            description="Try different keywords or check your spelling. Search looks through document names, extracted content, and tags."
          />
        )}

        {!isLoading && results.length > 0 && (
          <>
            <div className="mb-4 text-sm text-slate-500 dark:text-slate-400">
              {total} result{total !== 1 ? 's' : ''} found in {took}ms
            </div>

            <AdminSurface className="space-y-2">
              {results.map((result) => (
                <button
                  key={`${result.documentId}-${result.versionId}`}
                  onClick={() => router.push(`/rooms/${result.roomId}?doc=${result.documentId}`)}
                  className="flex w-full items-start gap-4 rounded-xl border border-slate-200/80 bg-white p-4 text-left transition-colors hover:border-sky-200 hover:bg-sky-50/40 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-sky-800 dark:hover:bg-sky-950/20"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900">
                    <FileText className="h-5 w-5 text-slate-500 dark:text-slate-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-neutral-900">
                        {result.title}
                      </h3>
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        {getMimeTypeLabel(result.mimeType)}
                      </Badge>
                    </div>
                    {result.snippet && (
                      <p
                        className="mt-1 line-clamp-2 text-sm text-neutral-600 [&>b]:font-semibold [&>b]:text-primary-700"
                        dangerouslySetInnerHTML={{ __html: result.snippet }}
                      />
                    )}
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-neutral-400">
                      <span className="flex items-center gap-1">
                        <FolderOpen className="h-3 w-3" />
                        {result.roomName}
                      </span>
                      {result.tags.length > 0 && <span>{result.tags.slice(0, 3).join(', ')}</span>}
                    </div>
                  </div>
                </button>
              ))}
            </AdminSurface>

            {/* Pagination */}
            {total > limit && (
              <div className="mt-6 flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => handlePageChange(Math.max(0, offset - limit))}
                >
                  Previous
                </Button>
                <span className="text-sm text-neutral-500">
                  Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + limit >= total}
                  onClick={() => handlePageChange(offset + limit)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}

        {!hasSearched && (
          <AdminEmptyState
            icon={<Search className="h-5 w-5" />}
            title="Search documents"
            description="Search across all documents by name, content, or tags. Full-text search looks inside PDFs and other supported formats."
          />
        )}
      </AdminPageContent>
    </>
  );
}
