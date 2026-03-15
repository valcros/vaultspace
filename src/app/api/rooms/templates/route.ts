/**
 * Room Templates API (F109)
 *
 * GET  /api/rooms/templates - List available templates
 * POST /api/rooms/templates - Create custom template
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';

// This route uses cookies for auth, so it must be dynamic
export const dynamic = 'force-dynamic';

// Built-in templates
const BUILT_IN_TEMPLATES = [
  {
    id: 'investor-data-room',
    name: 'Investor Data Room',
    description: 'Standard folder structure for fundraising and investor due diligence',
    isGlobal: true,
    structure: {
      folders: [
        { name: 'Company Overview', path: '/company-overview' },
        { name: 'Financials', path: '/financials' },
        { name: 'Cap Table', path: '/cap-table' },
        { name: 'Legal', path: '/legal' },
        { name: 'Team', path: '/team' },
        { name: 'Product', path: '/product' },
        { name: 'Market Analysis', path: '/market-analysis' },
        { name: 'Customer References', path: '/customer-references' },
      ],
    },
  },
  {
    id: 'ma-due-diligence',
    name: 'M&A Due Diligence',
    description: 'Comprehensive folder structure for mergers and acquisitions',
    isGlobal: true,
    structure: {
      folders: [
        { name: 'Corporate', path: '/corporate' },
        { name: 'Financial', path: '/financial' },
        { name: 'Legal', path: '/legal' },
        { name: 'Tax', path: '/tax' },
        { name: 'Intellectual Property', path: '/intellectual-property' },
        { name: 'HR & Employment', path: '/hr-employment' },
        { name: 'Operations', path: '/operations' },
        { name: 'Real Estate', path: '/real-estate' },
        { name: 'Environmental', path: '/environmental' },
        { name: 'Insurance', path: '/insurance' },
        { name: 'IT & Systems', path: '/it-systems' },
        { name: 'Contracts', path: '/contracts' },
      ],
    },
  },
  {
    id: 'board-portal',
    name: 'Board Portal',
    description: 'Organized structure for board meetings and governance documents',
    isGlobal: true,
    structure: {
      folders: [
        { name: 'Board Meetings', path: '/board-meetings' },
        { name: 'Committee Materials', path: '/committee-materials' },
        { name: 'Governance Documents', path: '/governance-documents' },
        { name: 'Financial Reports', path: '/financial-reports' },
        { name: 'Strategic Plans', path: '/strategic-plans' },
        { name: 'Compliance', path: '/compliance' },
      ],
    },
  },
  {
    id: 'compliance-audit',
    name: 'Compliance & Audit',
    description: 'Structure for regulatory compliance and audit documentation',
    isGlobal: true,
    structure: {
      folders: [
        { name: 'Policies & Procedures', path: '/policies-procedures' },
        { name: 'Audit Reports', path: '/audit-reports' },
        { name: 'Regulatory Filings', path: '/regulatory-filings' },
        { name: 'Certifications', path: '/certifications' },
        { name: 'Risk Assessment', path: '/risk-assessment' },
        { name: 'Training Records', path: '/training-records' },
      ],
    },
  },
];

/**
 * GET /api/rooms/templates
 * List available room templates (built-in + custom)
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await requireAuth();

    // Get custom templates for this organization
    const customTemplates = await db.roomTemplate.findMany({
      where: {
        organizationId: session.organizationId,
      },
      orderBy: { name: 'asc' },
    });

    // Combine built-in and custom templates
    const templates = [
      ...BUILT_IN_TEMPLATES.map((t) => ({
        ...t,
        isCustom: false,
      })),
      ...customTemplates.map((t) => ({
        ...t,
        isCustom: true,
      })),
    ];

    return NextResponse.json({ templates });
  } catch (error) {
    console.error('[TemplatesAPI] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to list templates' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/rooms/templates
 * Create a custom template (optionally from existing room)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check admin permission
    if (session.organization.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, description, fromRoomId, structure } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Template name is required' },
        { status: 400 }
      );
    }

    let templateStructure = structure;

    // If creating from existing room, copy its folder structure
    if (fromRoomId) {
      const room = await db.room.findFirst({
        where: {
          id: fromRoomId,
          organizationId: session.organizationId,
        },
        include: {
          folders: {
            select: {
              name: true,
              path: true,
              parentId: true,
            },
            orderBy: { path: 'asc' },
          },
        },
      });

      if (!room) {
        return NextResponse.json(
          { error: 'Source room not found' },
          { status: 404 }
        );
      }

      templateStructure = {
        folders: room.folders.map((f) => ({
          name: f.name,
          path: f.path,
        })),
      };
    }

    if (!templateStructure) {
      return NextResponse.json(
        { error: 'Template structure is required (or provide fromRoomId)' },
        { status: 400 }
      );
    }

    // Create template
    const template = await db.roomTemplate.create({
      data: {
        organizationId: session.organizationId,
        name: name.trim(),
        description: description?.trim(),
        category: body.category ?? 'custom',
        folderStructure: templateStructure,
        isSystemTemplate: false,
        isPublic: false,
      },
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    console.error('[TemplatesAPI] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create template' },
      { status: 500 }
    );
  }
}
