'use client';

import * as React from 'react';
import { ExternalLink, Copy, Check } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';
import { AdminPageContent, AdminToolbar } from '@/components/layout/admin-page';

const endpointGroups = [
  {
    name: 'Authentication',
    prefix: '/api/auth',
    description: 'Login, register, logout, and 2FA management. Sessions use HttpOnly cookies.',
    endpoints: [
      'POST /login',
      'POST /register',
      'POST /logout',
      'GET /me',
      'POST /2fa/setup',
      'POST /2fa/verify',
      'POST /2fa/validate',
      'POST /2fa/disable',
    ],
  },
  {
    name: 'Rooms',
    prefix: '/api/rooms',
    description:
      'Create, list, update, and delete data rooms. Manage room settings including NDA, watermark, and access control.',
    endpoints: [
      'GET /',
      'POST /',
      'GET /:roomId',
      'PATCH /:roomId',
      'DELETE /:roomId',
      'GET /:roomId/settings',
      'PATCH /:roomId/settings',
    ],
  },
  {
    name: 'Documents',
    prefix: '/api/rooms/:roomId/documents',
    description:
      'Upload documents, manage versions, generate previews, download files, and view analytics.',
    endpoints: [
      'GET /',
      'POST /',
      'GET /:documentId',
      'PATCH /:documentId',
      'DELETE /:documentId',
      'GET /:documentId/versions',
      'GET /:documentId/preview',
      'GET /:documentId/download',
      'GET /:documentId/analytics',
    ],
  },
  {
    name: 'E-Signatures',
    prefix: '/api/rooms/:roomId/documents/:documentId/signatures',
    description:
      'Request signatures on documents and manage signing workflow. Admins create requests; signers sign or decline.',
    endpoints: ['GET /', 'POST /', 'PATCH /:signatureId'],
  },
  {
    name: 'Q&A',
    prefix: '/api/rooms/:roomId/questions',
    description:
      'Question and answer workflow for due diligence. Viewers ask questions, admins provide answers.',
    endpoints: ['GET /', 'POST /', 'PATCH /:questionId'],
  },
  {
    name: 'Checklists',
    prefix: '/api/rooms/:roomId/checklists',
    description: 'Due diligence checklists with items that can be assigned and tracked.',
    endpoints: ['GET /', 'POST /', 'PATCH /:checklistId', 'DELETE /:checklistId'],
  },
  {
    name: 'Calendar',
    prefix: '/api/rooms/:roomId/calendar',
    description: 'Room calendar events for milestones, deadlines, review dates, and meetings.',
    endpoints: ['GET /', 'POST /', 'PATCH /:eventId', 'DELETE /:eventId'],
  },
  {
    name: 'Share Links',
    prefix: '/api/rooms/:roomId/links',
    description:
      'Create and manage shareable access links with configurable permissions, expiry, and email restrictions.',
    endpoints: ['GET /', 'POST /', 'PATCH /:linkId', 'DELETE /:linkId'],
  },
  {
    name: 'Search',
    prefix: '/api/search',
    description:
      'Full-text search across all documents in the organization with room-level filtering.',
    endpoints: ['GET /?q=query&roomId=optional'],
  },
  {
    name: 'Dashboard',
    prefix: '/api/dashboard',
    description:
      'Admin dashboard with organization statistics, recent activity, and room summaries.',
    endpoints: ['GET /'],
  },
  {
    name: 'Messages',
    prefix: '/api/messages',
    description: 'Internal messaging between organization members.',
    endpoints: ['GET /', 'POST /', 'GET /inbox', 'PATCH /:messageId'],
  },
  {
    name: 'Webhooks',
    prefix: '/api/settings/webhooks',
    description:
      'Configure webhook endpoints to receive event notifications (document uploads, views, Q&A activity).',
    endpoints: ['GET /', 'POST /', 'PATCH /:webhookId', 'DELETE /:webhookId'],
  },
  {
    name: 'Viewer',
    prefix: '/api/view/:shareToken',
    description:
      'Public viewer-facing API for share link access. Includes document browsing, preview, download, and Q&A.',
    endpoints: [
      'GET /info',
      'POST /access',
      'GET /documents',
      'GET /documents/:documentId',
      'GET /documents/:documentId/preview',
      'GET /documents/:documentId/download',
      'GET /questions',
      'POST /questions',
      'POST /logout',
    ],
  },
];

export default function ApiDocsPage() {
  const [copied, setCopied] = React.useState(false);
  const baseUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://app.vaultspace.org';
  const specUrl = `${baseUrl}/api/docs`;

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <PageHeader
        title="API Documentation"
        description="REST API reference for VaultSpace integrations"
      />

      <AdminPageContent>
        <AdminToolbar
          title="Integration reference"
          description="Reference the active REST surfaces, authentication model, and endpoint groups used by internal and external integrations."
        />
        {/* API Base URL */}
        <Card className="bg-white/88 rounded-[1.5rem] border-slate-200/80 shadow-[0_20px_46px_-34px_rgba(15,23,42,0.35)] ring-1 ring-white/50 dark:border-slate-800 dark:bg-slate-950/75 dark:ring-white/5">
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-neutral-500">API Base URL</h3>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 rounded-md bg-neutral-100 px-3 py-2 font-mono text-sm text-neutral-900">
                {baseUrl}
              </code>
              <button
                onClick={() => handleCopy(baseUrl)}
                className="rounded-md border border-neutral-200 p-2 text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700"
                title="Copy base URL"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
          </CardContent>
        </Card>

        {/* OpenAPI Spec Link */}
        <Card className="bg-white/88 rounded-[1.5rem] border-slate-200/80 shadow-[0_20px_46px_-34px_rgba(15,23,42,0.35)] ring-1 ring-white/50 dark:border-slate-800 dark:bg-slate-950/75 dark:ring-white/5">
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-neutral-500">OpenAPI Specification</h3>
            <p className="mt-1 text-sm text-neutral-600">
              The full OpenAPI 3.0 JSON spec is available for import into tools like Swagger UI,
              Postman, or Insomnia.
            </p>
            <div className="mt-3">
              <a
                href="/api/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                View OpenAPI Spec
                <ExternalLink className="h-4 w-4" />
              </a>
              <button
                onClick={() => handleCopy(specUrl)}
                className="ml-3 inline-flex items-center gap-2 rounded-md border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Copy URL
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Authentication Info */}
        <Card className="bg-white/88 rounded-[1.5rem] border-slate-200/80 shadow-[0_20px_46px_-34px_rgba(15,23,42,0.35)] ring-1 ring-white/50 dark:border-slate-800 dark:bg-slate-950/75 dark:ring-white/5">
          <CardContent className="p-6">
            <h3 className="font-medium text-neutral-900">Authentication</h3>
            <p className="mt-2 text-sm text-neutral-600">
              VaultSpace uses cookie-based session authentication. After a successful login via{' '}
              <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">
                POST /api/auth/login
              </code>
              , a session cookie (
              <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">vaultspace-session</code>
              ) is set automatically. All subsequent API requests must include this cookie.
            </p>
            <ul className="mt-3 space-y-1 text-sm text-neutral-600">
              <li>
                Cookie:{' '}
                <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">
                  vaultspace-session
                </code>{' '}
                (HttpOnly, Secure, SameSite=Lax)
              </li>
              <li>Idle timeout: 24 hours (sliding window)</li>
              <li>Absolute max session: 7 days</li>
              <li>2FA: If enabled, requires a second verification step after login</li>
            </ul>
          </CardContent>
        </Card>

        {/* Endpoint Groups */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-slate-950 dark:text-white">
            Endpoint Groups
          </h2>
          <div className="space-y-4">
            {endpointGroups.map((group) => (
              <Card
                key={group.name}
                className="bg-white/88 rounded-[1.5rem] border-slate-200/80 shadow-[0_20px_46px_-34px_rgba(15,23,42,0.35)] ring-1 ring-white/50 dark:border-slate-800 dark:bg-slate-950/75 dark:ring-white/5"
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium text-neutral-900">{group.name}</h3>
                      <p className="mt-1 text-sm text-neutral-500">{group.description}</p>
                      <code className="mt-2 inline-block rounded bg-neutral-100 px-2 py-1 font-mono text-xs text-neutral-700">
                        {group.prefix}
                      </code>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {group.endpoints.map((endpoint) => {
                      const method = endpoint.split(' ')[0] ?? '';
                      const methodColors: Record<string, string> = {
                        GET: 'bg-green-100 text-green-700',
                        POST: 'bg-blue-100 text-blue-700',
                        PATCH: 'bg-yellow-100 text-yellow-700',
                        DELETE: 'bg-red-100 text-red-700',
                      };
                      return (
                        <span
                          key={endpoint}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${methodColors[method] || 'bg-neutral-100 text-neutral-700'}`}
                        >
                          {endpoint}
                        </span>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </AdminPageContent>
    </>
  );
}
