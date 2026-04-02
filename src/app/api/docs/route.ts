/**
 * OpenAPI / Swagger JSON Spec Endpoint (F051)
 *
 * GET /api/docs - Returns the OpenAPI 3.0 specification for VaultSpace API
 * Public endpoint, no authentication required.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'VaultSpace API',
    version: '1.0.0',
    description:
      'VaultSpace is a secure Virtual Data Room (VDR) platform. This API provides endpoints for managing organizations, data rooms, documents, Q&A, checklists, calendar events, and more.',
    license: {
      name: 'AGPL-3.0',
      url: 'https://www.gnu.org/licenses/agpl-3.0.html',
    },
  },
  servers: [
    {
      url: '{baseUrl}',
      description: 'VaultSpace instance',
      variables: {
        baseUrl: {
          default: 'https://app.vaultspace.org',
          description: 'Base URL of the VaultSpace deployment',
        },
      },
    },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'vaultspace-session',
        description:
          'Session cookie set after successful login. HttpOnly, Secure, SameSite=Lax. Idle timeout: 24h (sliding window). Absolute max: 7 days.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', description: 'Error message' },
        },
        required: ['error'],
      },
      Room: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          slug: { type: 'string' },
          description: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'ARCHIVED', 'CLOSED'] },
          totalDocuments: { type: 'integer' },
          totalFolders: { type: 'integer' },
          totalViews: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Document: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          mimeType: { type: 'string' },
          fileSize: { type: 'integer' },
          status: { type: 'string', enum: ['ACTIVE', 'ARCHIVED', 'DELETED'] },
          tags: { type: 'array', items: { type: 'string' } },
          category: { type: 'string', nullable: true },
          viewCount: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      SignatureRequest: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          signerEmail: { type: 'string', format: 'email' },
          signerName: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['PENDING', 'SIGNED', 'DECLINED', 'EXPIRED'] },
          signedAt: { type: 'string', format: 'date-time', nullable: true },
          declinedAt: { type: 'string', format: 'date-time', nullable: true },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Question: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string' },
          status: { type: 'string', enum: ['OPEN', 'ANSWERED', 'CLOSED'] },
          priority: { type: 'string', enum: ['NORMAL', 'HIGH', 'URGENT'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ cookieAuth: [] }],
  tags: [
    { name: 'Auth', description: 'Authentication and session management' },
    { name: 'Rooms', description: 'Data room CRUD and management' },
    { name: 'Documents', description: 'Document upload, versioning, preview, and download' },
    { name: 'Signatures', description: 'E-signature workflow (F046-F050)' },
    { name: 'Q&A', description: 'Question and answer workflow for viewers' },
    { name: 'Checklists', description: 'Due diligence checklists' },
    { name: 'Calendar', description: 'Room calendar events and deadlines' },
    { name: 'Share Links', description: 'Shareable access link management' },
    { name: 'Search', description: 'Full-text document search' },
    { name: 'Dashboard', description: 'Admin dashboard statistics' },
    { name: 'Messages', description: 'Internal messaging system' },
    { name: 'Webhooks', description: 'Webhook event notification configuration' },
    { name: 'Viewer', description: 'Viewer-facing API for share link access' },
  ],
  paths: {
    // =========================================================================
    // Auth
    // =========================================================================
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email and password',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
                required: ['email', 'password'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Login successful. Session cookie is set.' },
          '401': { description: 'Invalid credentials' },
        },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new account',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                  organizationName: { type: 'string' },
                },
                required: ['email', 'password', 'firstName', 'lastName', 'organizationName'],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Account created. Session cookie is set.' },
          '409': { description: 'Email already in use' },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout and invalidate session',
        responses: {
          '200': { description: 'Logged out successfully' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get current authenticated user info',
        responses: {
          '200': { description: 'Current user and organization details' },
          '401': { description: 'Not authenticated' },
        },
      },
    },
    '/api/auth/2fa/setup': {
      post: {
        tags: ['Auth'],
        summary: 'Initialize 2FA setup (generates TOTP secret)',
        responses: {
          '200': { description: 'TOTP secret and QR code URI returned' },
        },
      },
    },
    '/api/auth/2fa/verify': {
      post: {
        tags: ['Auth'],
        summary: 'Verify TOTP code to complete 2FA setup',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { code: { type: 'string' } },
                required: ['code'],
              },
            },
          },
        },
        responses: {
          '200': { description: '2FA enabled, backup codes returned' },
          '400': { description: 'Invalid code' },
        },
      },
    },
    '/api/auth/2fa/validate': {
      post: {
        tags: ['Auth'],
        summary: 'Validate 2FA code during login',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { code: { type: 'string' } },
                required: ['code'],
              },
            },
          },
        },
        responses: {
          '200': { description: '2FA validated, session upgraded' },
          '401': { description: 'Invalid code' },
        },
      },
    },
    '/api/auth/2fa/disable': {
      post: {
        tags: ['Auth'],
        summary: 'Disable 2FA for current user',
        responses: {
          '200': { description: '2FA disabled' },
        },
      },
    },

    // =========================================================================
    // Rooms
    // =========================================================================
    '/api/rooms': {
      get: {
        tags: ['Rooms'],
        summary: 'List all rooms in the organization',
        parameters: [
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string' },
            description: 'Filter by room status',
          },
        ],
        responses: {
          '200': {
            description: 'List of rooms',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    rooms: { type: 'array', items: { $ref: '#/components/schemas/Room' } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Rooms'],
        summary: 'Create a new data room',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['name'],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Room created' },
        },
      },
    },
    '/api/rooms/{roomId}': {
      get: {
        tags: ['Rooms'],
        summary: 'Get room details',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Room details' },
          '404': { description: 'Room not found' },
        },
      },
      patch: {
        tags: ['Rooms'],
        summary: 'Update room settings',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Room updated' },
        },
      },
      delete: {
        tags: ['Rooms'],
        summary: 'Delete a room',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Room deleted' },
        },
      },
    },
    '/api/rooms/{roomId}/settings': {
      get: {
        tags: ['Rooms'],
        summary: 'Get room settings (NDA, watermark, access control)',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Room settings' } },
      },
      patch: {
        tags: ['Rooms'],
        summary: 'Update room settings',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Settings updated' } },
      },
    },

    // =========================================================================
    // Documents
    // =========================================================================
    '/api/rooms/{roomId}/documents': {
      get: {
        tags: ['Documents'],
        summary: 'List documents in a room',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'List of documents',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    documents: { type: 'array', items: { $ref: '#/components/schemas/Document' } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Documents'],
        summary: 'Upload a new document',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Document uploaded' },
        },
      },
    },
    '/api/rooms/{roomId}/documents/{documentId}': {
      get: {
        tags: ['Documents'],
        summary: 'Get document details and versions',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Document details' },
          '404': { description: 'Not found' },
        },
      },
      patch: {
        tags: ['Documents'],
        summary: 'Update document metadata (name, tags, category)',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Document updated' } },
      },
      delete: {
        tags: ['Documents'],
        summary: 'Soft-delete document (move to trash)',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Document deleted' } },
      },
    },
    '/api/rooms/{roomId}/documents/{documentId}/versions': {
      get: {
        tags: ['Documents'],
        summary: 'List document versions',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Version list' } },
      },
    },
    '/api/rooms/{roomId}/documents/{documentId}/preview': {
      get: {
        tags: ['Documents'],
        summary: 'Get document preview (signed URL)',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Preview data with signed URLs' } },
      },
    },
    '/api/rooms/{roomId}/documents/{documentId}/download': {
      get: {
        tags: ['Documents'],
        summary: 'Download original document file',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'File download (redirect to signed URL)' } },
      },
    },
    '/api/rooms/{roomId}/documents/{documentId}/analytics': {
      get: {
        tags: ['Documents'],
        summary: 'Get document view/download analytics',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Analytics data (views, downloads, time spent)' } },
      },
    },

    // =========================================================================
    // Signatures (F046-F050)
    // =========================================================================
    '/api/rooms/{roomId}/documents/{documentId}/signatures': {
      get: {
        tags: ['Signatures'],
        summary: 'List signature requests for a document (admin)',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'List of signature requests',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    signatureRequests: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/SignatureRequest' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Signatures'],
        summary: 'Request a signature on a document (admin)',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  signerEmail: { type: 'string', format: 'email' },
                  signerName: { type: 'string' },
                  expiresAt: { type: 'string', format: 'date-time' },
                },
                required: ['signerEmail'],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Signature request created' },
          '409': { description: 'Pending request already exists for this signer' },
        },
      },
    },
    '/api/rooms/{roomId}/documents/{documentId}/signatures/{signatureId}': {
      patch: {
        tags: ['Signatures'],
        summary: 'Sign or decline a signature request',
        description: 'Accessible by admin or the designated signer (matched by session email).',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'signatureId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  action: { type: 'string', enum: ['sign', 'decline'] },
                  signatureData: {
                    type: 'string',
                    description: 'Base64 signature image or typed name (required for sign)',
                  },
                  signatureType: { type: 'string', enum: ['drawn', 'typed', 'uploaded'] },
                  declineReason: { type: 'string' },
                },
                required: ['action'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Signature request updated' },
          '409': { description: 'Request already signed/declined' },
          '410': { description: 'Request expired' },
        },
      },
    },

    // =========================================================================
    // Q&A
    // =========================================================================
    '/api/rooms/{roomId}/questions': {
      get: {
        tags: ['Q&A'],
        summary: 'List questions in a room',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'List of questions',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    questions: { type: 'array', items: { $ref: '#/components/schemas/Question' } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Q&A'],
        summary: 'Submit a new question',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: 'Question submitted' } },
      },
    },

    // =========================================================================
    // Checklists
    // =========================================================================
    '/api/rooms/{roomId}/checklists': {
      get: {
        tags: ['Checklists'],
        summary: 'List checklists in a room',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'List of checklists with items' } },
      },
      post: {
        tags: ['Checklists'],
        summary: 'Create a new checklist',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: 'Checklist created' } },
      },
    },
    '/api/rooms/{roomId}/checklists/{checklistId}': {
      patch: {
        tags: ['Checklists'],
        summary: 'Update checklist',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'checklistId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Checklist updated' } },
      },
      delete: {
        tags: ['Checklists'],
        summary: 'Delete checklist',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'checklistId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Checklist deleted' } },
      },
    },

    // =========================================================================
    // Calendar
    // =========================================================================
    '/api/rooms/{roomId}/calendar': {
      get: {
        tags: ['Calendar'],
        summary: 'List calendar events for a room',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'List of calendar events' } },
      },
      post: {
        tags: ['Calendar'],
        summary: 'Create a calendar event',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: 'Event created' } },
      },
    },
    '/api/rooms/{roomId}/calendar/{eventId}': {
      patch: {
        tags: ['Calendar'],
        summary: 'Update a calendar event',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'eventId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Event updated' } },
      },
      delete: {
        tags: ['Calendar'],
        summary: 'Delete a calendar event',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'eventId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Event deleted' } },
      },
    },

    // =========================================================================
    // Share Links
    // =========================================================================
    '/api/rooms/{roomId}/links': {
      get: {
        tags: ['Share Links'],
        summary: 'List share links for a room',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'List of share links' } },
      },
      post: {
        tags: ['Share Links'],
        summary: 'Create a new share link',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: 'Share link created' } },
      },
    },
    '/api/rooms/{roomId}/links/{linkId}': {
      patch: {
        tags: ['Share Links'],
        summary: 'Update share link settings',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'linkId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Link updated' } },
      },
      delete: {
        tags: ['Share Links'],
        summary: 'Revoke a share link',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'linkId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Link revoked' } },
      },
    },

    // =========================================================================
    // Search
    // =========================================================================
    '/api/search': {
      get: {
        tags: ['Search'],
        summary: 'Full-text search across documents',
        parameters: [
          {
            name: 'q',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'Search query',
          },
          {
            name: 'roomId',
            in: 'query',
            schema: { type: 'string' },
            description: 'Limit to specific room',
          },
        ],
        responses: { '200': { description: 'Search results with document matches' } },
      },
    },

    // =========================================================================
    // Dashboard
    // =========================================================================
    '/api/dashboard': {
      get: {
        tags: ['Dashboard'],
        summary: 'Get admin dashboard statistics',
        responses: {
          '200': {
            description: 'Dashboard stats (rooms, documents, views, recent activity)',
          },
        },
      },
    },

    // =========================================================================
    // Messages
    // =========================================================================
    '/api/messages': {
      get: {
        tags: ['Messages'],
        summary: 'List sent messages',
        responses: { '200': { description: 'List of sent messages' } },
      },
      post: {
        tags: ['Messages'],
        summary: 'Send a new message',
        responses: { '201': { description: 'Message sent' } },
      },
    },
    '/api/messages/inbox': {
      get: {
        tags: ['Messages'],
        summary: 'List received messages',
        responses: { '200': { description: 'List of received messages' } },
      },
    },
    '/api/messages/{messageId}': {
      patch: {
        tags: ['Messages'],
        summary: 'Mark message as read',
        parameters: [{ name: 'messageId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Message updated' } },
      },
    },

    // =========================================================================
    // Webhooks
    // =========================================================================
    '/api/settings/webhooks': {
      get: {
        tags: ['Webhooks'],
        summary: 'List configured webhooks',
        responses: { '200': { description: 'List of webhooks' } },
      },
      post: {
        tags: ['Webhooks'],
        summary: 'Create a webhook endpoint',
        responses: { '201': { description: 'Webhook created' } },
      },
    },
    '/api/settings/webhooks/{webhookId}': {
      patch: {
        tags: ['Webhooks'],
        summary: 'Update webhook configuration',
        parameters: [{ name: 'webhookId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Webhook updated' } },
      },
      delete: {
        tags: ['Webhooks'],
        summary: 'Delete a webhook',
        parameters: [{ name: 'webhookId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Webhook deleted' } },
      },
    },

    // =========================================================================
    // Viewer
    // =========================================================================
    '/api/view/{shareToken}/info': {
      get: {
        tags: ['Viewer'],
        summary: 'Get room info for a share link (public)',
        security: [],
        parameters: [
          { name: 'shareToken', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Room name, branding, NDA requirements' } },
      },
    },
    '/api/view/{shareToken}/access': {
      post: {
        tags: ['Viewer'],
        summary: 'Request viewer access (email verification, password)',
        security: [],
        parameters: [
          { name: 'shareToken', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Viewer session created' } },
      },
    },
    '/api/view/{shareToken}/documents': {
      get: {
        tags: ['Viewer'],
        summary: 'List documents accessible via share link',
        parameters: [
          { name: 'shareToken', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'List of viewable documents' } },
      },
    },
    '/api/view/{shareToken}/documents/{documentId}': {
      get: {
        tags: ['Viewer'],
        summary: 'Get document details as viewer',
        parameters: [
          { name: 'shareToken', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Document details for viewer' } },
      },
    },
    '/api/view/{shareToken}/documents/{documentId}/preview': {
      get: {
        tags: ['Viewer'],
        summary: 'Get document preview as viewer',
        parameters: [
          { name: 'shareToken', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Preview with signed URLs' } },
      },
    },
    '/api/view/{shareToken}/documents/{documentId}/download': {
      get: {
        tags: ['Viewer'],
        summary: 'Download document as viewer (if permitted)',
        parameters: [
          { name: 'shareToken', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'File download' },
          '403': { description: 'Downloads not allowed' },
        },
      },
    },
    '/api/view/{shareToken}/questions': {
      get: {
        tags: ['Viewer'],
        summary: 'List and submit Q&A questions as viewer',
        parameters: [
          { name: 'shareToken', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'List of Q&A questions' } },
      },
      post: {
        tags: ['Viewer'],
        summary: 'Submit a question as viewer',
        parameters: [
          { name: 'shareToken', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '201': { description: 'Question submitted' } },
      },
    },
    '/api/view/{shareToken}/logout': {
      post: {
        tags: ['Viewer'],
        summary: 'Logout viewer session',
        parameters: [
          { name: 'shareToken', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Viewer session ended' } },
      },
    },
  },
};

export async function GET() {
  return NextResponse.json(openApiSpec, {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
