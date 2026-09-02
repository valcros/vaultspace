import { MAX_FOLDER_DEPTH } from './folderDepth';

export interface StarterFolderDefinition {
  name: string;
  path: string;
}

export interface StarterFolderTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  isGlobal: true;
  structure: { folders: StarterFolderDefinition[] };
}

/**
 * These templates create independent room-owned folders only. They never copy
 * documents or grant cross-room access. Company Library views are a later,
 * separately authorized architecture.
 */
export const BUILT_IN_ROOM_TEMPLATES: readonly StarterFolderTemplate[] = [
  {
    id: 'investor-data-room',
    name: 'Investor Data Room',
    description: 'Fundraising materials for prospective investors and diligence advisors.',
    category: 'fundraising',
    isGlobal: true,
    structure: {
      folders: [
        { name: 'Company Overview', path: '/company-overview' },
        { name: 'Mission & History', path: '/company-overview/mission-history' },
        { name: 'Corporate Governance', path: '/company-overview/corporate-governance' },
        { name: 'Financials', path: '/financials' },
        { name: 'Historical Financials', path: '/financials/historical-financials' },
        { name: 'Forecasts & Budget', path: '/financials/forecasts-budget' },
        { name: 'Cap Table', path: '/cap-table' },
        { name: 'Legal', path: '/legal' },
        { name: 'Material Contracts', path: '/legal/material-contracts' },
        { name: 'Team', path: '/team' },
        { name: 'Product & Technology', path: '/product-technology' },
        { name: 'Technology & Security', path: '/product-technology/technology-security' },
        { name: 'Market & Customers', path: '/market-customers' },
        { name: 'Customer References', path: '/market-customers/customer-references' },
      ],
    },
  },
  {
    id: 'ma-due-diligence',
    name: 'M&A Due Diligence',
    description: 'A buyer-oriented diligence structure for a transaction process.',
    category: 'ma',
    isGlobal: true,
    structure: {
      folders: [
        { name: 'Corporate', path: '/corporate' },
        { name: 'Formation & Governance', path: '/corporate/formation-governance' },
        { name: 'Financial', path: '/financial' },
        { name: 'Financial Statements', path: '/financial/financial-statements' },
        { name: 'Tax', path: '/tax' },
        { name: 'Legal', path: '/legal' },
        { name: 'Material Contracts', path: '/legal/material-contracts' },
        { name: 'Intellectual Property', path: '/intellectual-property' },
        { name: 'HR & Employment', path: '/hr-employment' },
        { name: 'Operations', path: '/operations' },
        { name: 'IT & Systems', path: '/it-systems' },
        { name: 'Compliance & Risk', path: '/compliance-risk' },
      ],
    },
  },
  {
    id: 'board-portal',
    name: 'Board Portal',
    description: 'Board governance, meeting, finance, strategy, and committee materials.',
    category: 'governance',
    isGlobal: true,
    structure: {
      folders: [
        { name: 'Board Meetings', path: '/board-meetings' },
        { name: 'Meeting Agendas & Minutes', path: '/board-meetings/agendas-minutes' },
        { name: 'Committee Materials', path: '/committee-materials' },
        { name: 'Governance Documents', path: '/governance-documents' },
        { name: 'Financial Reports', path: '/financial-reports' },
        { name: 'Strategic Plans', path: '/strategic-plans' },
        { name: 'Compliance & Risk', path: '/compliance-risk' },
      ],
    },
  },
  {
    id: 'compliance-audit',
    name: 'Compliance & Audit',
    description: 'Policies, audit evidence, certifications, training, and risk records.',
    category: 'compliance',
    isGlobal: true,
    structure: {
      folders: [
        { name: 'Policies & Procedures', path: '/policies-procedures' },
        { name: 'Audit Evidence', path: '/audit-evidence' },
        { name: 'Audit Reports', path: '/audit-evidence/audit-reports' },
        { name: 'Regulatory Filings', path: '/regulatory-filings' },
        { name: 'Certifications', path: '/certifications' },
        { name: 'Risk Assessment', path: '/risk-assessment' },
        { name: 'Training Records', path: '/training-records' },
      ],
    },
  },
] as const;

export function getBuiltInRoomTemplate(templateId: string): StarterFolderTemplate | undefined {
  return BUILT_IN_ROOM_TEMPLATES.find((template) => template.id === templateId);
}

function isFolderDefinition(value: unknown): value is StarterFolderDefinition {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const folder = value as Record<string, unknown>;
  return typeof folder['name'] === 'string' && typeof folder['path'] === 'string';
}

/** Turns persisted custom-template JSON into the same safe folder contract. */
export function readTemplateFolders(structure: unknown): StarterFolderDefinition[] | null {
  if (!structure || typeof structure !== 'object') {
    return null;
  }
  const folders = (structure as { folders?: unknown }).folders;
  if (!Array.isArray(folders) || !folders.every(isFolderDefinition)) {
    return null;
  }
  return folders.map(({ name, path }) => ({ name: name.trim(), path: path.trim() }));
}

function parentPath(path: string): string | null {
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return null;
  }
  return `/${segments.slice(0, -1).join('/')}`;
}

export type StarterFolderSelection =
  | { ok: true; folders: StarterFolderDefinition[] }
  | { ok: false; error: string };

/**
 * Validates a template selection at the server boundary. A caller can choose
 * no folders, but cannot inject arbitrary paths. Required ancestors are added
 * automatically so client retry/replay cannot create an orphaned tree.
 */
export function resolveStarterFolderSelection(
  folders: StarterFolderDefinition[],
  selectedFolderPaths?: string[]
): StarterFolderSelection {
  const paths = new Set<string>();
  for (const folder of folders) {
    const depth = folder.path.split('/').filter(Boolean).length;
    if (
      !folder.name ||
      folder.name.length > 255 ||
      !/^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(folder.path) ||
      depth > MAX_FOLDER_DEPTH ||
      paths.has(folder.path)
    ) {
      return { ok: false, error: 'The selected folder template has an invalid structure' };
    }
    paths.add(folder.path);
  }

  const chosen = new Set(selectedFolderPaths === undefined ? paths : selectedFolderPaths);
  for (const path of chosen) {
    if (!paths.has(path)) {
      return { ok: false, error: 'The selected folders do not belong to this template' };
    }
    let ancestor = parentPath(path);
    while (ancestor) {
      if (!paths.has(ancestor)) {
        return {
          ok: false,
          error: 'The selected folder template is missing a required parent folder',
        };
      }
      chosen.add(ancestor);
      ancestor = parentPath(ancestor);
    }
  }

  return { ok: true, folders: folders.filter((folder) => chosen.has(folder.path)) };
}
