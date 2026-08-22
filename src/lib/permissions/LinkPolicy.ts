import { randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';
import { Prisma, type LinkPermission, type LinkScope, type PermissionLevel } from '@prisma/client';

import { bootstrapDb, withOrgContext } from '@/lib/db';
import { isIpAllowed } from '@/lib/utils/ip';

export type LinkPolicyAction = 'view' | 'download';

export type LinkPolicyDenialCode =
  | 'LINK_NOT_FOUND'
  | 'LINK_INACTIVE'
  | 'LINK_EXPIRED'
  | 'MAX_VIEWS_REACHED'
  | 'ROOM_NOT_ACTIVE'
  | 'ORGANIZATION_MISMATCH'
  | 'ROOM_MISMATCH'
  | 'LINK_SCOPE_INVALID'
  | 'PASSWORD_REQUIRED'
  | 'PASSWORD_INVALID'
  | 'LINK_CONFIGURATION_ERROR'
  | 'ASSERTED_EMAIL_REQUIRED'
  | 'ASSERTED_EMAIL_INVALID'
  | 'ASSERTED_EMAIL_NOT_ALLOWED'
  | 'NDA_ACCEPTANCE_REQUIRED'
  | 'IP_NOT_ALLOWED'
  | 'SESSION_INVALID'
  | 'SESSION_TIME_LIMIT_EXCEEDED'
  | 'LINK_PERMISSION_INSUFFICIENT';

export type LinkPolicyDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: LinkPolicyDenialCode;
      status: number;
      message: string;
    };

export const linkPolicySelect = {
  id: true,
  updatedAt: true,
  organizationId: true,
  roomId: true,
  slug: true,
  name: true,
  permission: true,
  scope: true,
  scopedFolderId: true,
  scopedDocumentId: true,
  isActive: true,
  expiresAt: true,
  maxViews: true,
  viewCount: true,
  maxSessionMinutes: true,
  requiresPassword: true,
  passwordHash: true,
  requiresEmailVerification: true,
  allowedEmails: true,
  room: {
    select: {
      id: true,
      organizationId: true,
      name: true,
      status: true,
      requiresNda: true,
      ndaContent: true,
      ipAllowlist: true,
      brandColor: true,
      brandLogoUrl: true,
    },
  },
  organization: {
    select: {
      id: true,
      name: true,
      logoUrl: true,
      primaryColor: true,
    },
  },
} satisfies Prisma.LinkSelect;

export type LinkPolicyRecord = Prisma.LinkGetPayload<{ select: typeof linkPolicySelect }>;

export interface LinkAdmissionInput {
  password?: string;
  email?: string;
  ndaAccepted?: boolean;
  sourceIp: string;
  userAgent: string | null;
  // This value is derived by the route from a valid VaultSpace session and a
  // same-organization active membership. It is never client supplied.
  authenticatedMember?: {
    userId: string;
    organizationId: string;
    email: string;
    ndaOnFile: boolean;
  };
}

export interface LinkAdmissionSuccess {
  allowed: true;
  session: { id: string };
  sessionToken: string;
  normalizedEmail: string | null;
  ndaOnFileApplied: boolean;
}

export type LinkAdmissionResult =
  | LinkAdmissionSuccess
  | Exclude<LinkPolicyDecision, { allowed: true }>;

export interface LinkServeSession {
  id: string;
  createdAt: Date;
  isActive: boolean;
  organizationId: string;
  roomId: string;
  linkId: string | null;
  link: {
    id: string;
    slug: string;
    isActive: boolean;
    organizationId: string;
    roomId: string;
    expiresAt: Date | null;
    maxSessionMinutes: number | null;
    permission: LinkPermission;
    scope: LinkScope;
    scopedFolderId: string | null;
    scopedDocumentId: string | null;
    room: {
      id: string;
      organizationId: string;
      status: string;
    };
  } | null;
}

export interface LinkResourceTarget {
  organizationId: string;
  roomId: string;
  folderId?: string | null;
  documentId?: string | null;
}

interface LinkScopeRecord {
  scope: LinkScope;
  scopedFolderId: string | null;
  scopedDocumentId: string | null;
}

interface ViewerDocumentScopeTarget {
  id: string;
  folderId: string | null;
}

function deny(
  code: LinkPolicyDenialCode,
  status: number,
  message: string
): Exclude<LinkPolicyDecision, { allowed: true }> {
  return { allowed: false, code, status, message };
}

function isValidEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hasValidStoredScope(link: LinkScopeRecord): boolean {
  if (link.scope === 'ENTIRE_ROOM') {
    return true;
  }
  if (link.scope === 'FOLDER') {
    return Boolean(link.scopedFolderId);
  }
  return link.scope === 'DOCUMENT' && Boolean(link.scopedDocumentId);
}

/**
 * Resolve the complete, minimal record required by every public link gate.
 * This is a pre-RLS bootstrap by unguessable share slug; all writes and scoped
 * resource reads occur later inside the resolved organization context.
 */
export async function getLinkPolicyRecord(shareToken: string): Promise<LinkPolicyRecord | null> {
  return bootstrapDb.link.findUnique({
    where: { slug: shareToken },
    select: linkPolicySelect,
  });
}

/**
 * Evaluate persisted state common to public information, admission, and serve.
 * Maximum views is admission-only and is deliberately excluded unless asked.
 */
export function evaluateLinkState(
  link: LinkPolicyRecord,
  options: { now?: Date; admission?: boolean } = {}
): LinkPolicyDecision {
  const now = options.now ?? new Date();

  if (!link.isActive) {
    return deny('LINK_INACTIVE', 404, 'This link is invalid or inactive');
  }
  if (
    link.organization.id !== link.organizationId ||
    link.room.organizationId !== link.organizationId
  ) {
    return deny('ORGANIZATION_MISMATCH', 404, 'This link is invalid');
  }
  if (link.room.id !== link.roomId) {
    return deny('ROOM_MISMATCH', 404, 'This link is invalid');
  }
  if (!hasValidStoredScope(link)) {
    return deny('LINK_SCOPE_INVALID', 404, 'This link is invalid');
  }
  if (link.expiresAt && link.expiresAt <= now) {
    return deny('LINK_EXPIRED', 410, 'This link has expired');
  }
  if (link.room.status !== 'ACTIVE') {
    return deny('ROOM_NOT_ACTIVE', 403, 'Room is not accessible');
  }
  if (options.admission && link.maxViews !== null && link.viewCount >= link.maxViews) {
    return deny('MAX_VIEWS_REACHED', 410, 'Link has reached maximum views');
  }

  return { allowed: true };
}

/**
 * Evaluate all admission gates represented by the current schema. There is no
 * persisted access-window schedule, so schedule evaluation is intentionally N/A.
 */
export async function evaluateLinkAdmission(
  link: LinkPolicyRecord,
  input: LinkAdmissionInput,
  now = new Date()
): Promise<LinkPolicyDecision> {
  const state = evaluateLinkState(link, { now, admission: true });
  if (!state.allowed) {
    return state;
  }

  if (link.room.ipAllowlist.length > 0 && !isIpAllowed(input.sourceIp, link.room.ipAllowlist)) {
    return deny('IP_NOT_ALLOWED', 403, 'Access denied: your IP address is not allowed.');
  }

  if (link.requiresPassword) {
    if (!input.password) {
      return deny('PASSWORD_REQUIRED', 401, 'Password is required');
    }
    if (!link.passwordHash) {
      return deny('LINK_CONFIGURATION_ERROR', 500, 'Link configuration error');
    }
    if (!(await bcrypt.compare(input.password, link.passwordHash))) {
      return deny('PASSWORD_INVALID', 401, 'Invalid password');
    }
  }

  const trustedMemberEmail =
    input.authenticatedMember?.organizationId === link.organizationId
      ? input.authenticatedMember.email
      : null;
  // An authenticated same-organization member has a verified VaultSpace
  // identity. Do not let a public form field substitute a different asserted
  // address for a link's email gate.
  const admissionEmail = trustedMemberEmail ?? input.email;
  if (link.requiresEmailVerification || link.allowedEmails.length > 0) {
    if (!admissionEmail) {
      return deny('ASSERTED_EMAIL_REQUIRED', 401, 'A valid email address is required');
    }
    const normalizedEmail = admissionEmail.toLowerCase().trim();
    if (!isValidEmail(normalizedEmail)) {
      return deny('ASSERTED_EMAIL_INVALID', 400, 'A valid email address is required');
    }
    if (
      link.allowedEmails.length > 0 &&
      !link.allowedEmails.some((allowed) => allowed.toLowerCase().trim() === normalizedEmail)
    ) {
      return deny(
        'ASSERTED_EMAIL_NOT_ALLOWED',
        403,
        'Email address is not authorized for this link'
      );
    }
  }

  const trustedNdaOnFile =
    input.authenticatedMember?.organizationId === link.organizationId &&
    input.authenticatedMember.ndaOnFile === true;
  if (link.room.requiresNda && input.ndaAccepted !== true && !trustedNdaOnFile) {
    return deny('NDA_ACCEPTANCE_REQUIRED', 400, 'NDA acceptance is required');
  }

  return { allowed: true };
}

async function storedScopeExists(
  tx: Prisma.TransactionClient,
  link: LinkPolicyRecord
): Promise<boolean> {
  if (link.scope === 'ENTIRE_ROOM') {
    return true;
  }
  if (link.scope === 'FOLDER' && link.scopedFolderId) {
    return Boolean(
      await tx.folder.findFirst({
        where: {
          id: link.scopedFolderId,
          roomId: link.roomId,
          organizationId: link.organizationId,
        },
        select: { id: true },
      })
    );
  }
  if (link.scope === 'DOCUMENT' && link.scopedDocumentId) {
    return Boolean(
      await tx.document.findFirst({
        where: {
          id: link.scopedDocumentId,
          roomId: link.roomId,
          organizationId: link.organizationId,
        },
        select: { id: true },
      })
    );
  }
  return false;
}

/**
 * Create a viewer session and consume one admission atomically. A PostgreSQL
 * row lock serializes the state check and increment, so concurrent final
 * admissions cannot both succeed. A successful final admission remains valid
 * during serve because maxViews is not a serve-phase revocation gate.
 */
export async function admitLinkViewer(
  link: LinkPolicyRecord,
  input: LinkAdmissionInput
): Promise<LinkAdmissionResult> {
  const initialDecision = evaluateLinkState(link, { admission: true });
  if (!initialDecision.allowed) {
    return initialDecision;
  }

  const normalizedEmail =
    input.authenticatedMember?.organizationId === link.organizationId
      ? input.authenticatedMember.email.toLowerCase().trim()
      : input.email?.toLowerCase().trim() || null;
  const sessionToken = randomBytes(32).toString('base64url');

  return withOrgContext(link.organizationId, async (tx) => {
    const lockedLink = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT link."id"
        FROM "links" AS link
       WHERE link."id" = ${link.id}
         AND link."organizationId" = ${link.organizationId}
         AND link."roomId" = ${link.roomId}
       FOR UPDATE
    `);
    if (lockedLink.length !== 1) {
      return deny('LINK_NOT_FOUND', 404, 'This link is invalid');
    }

    // Keep room status, tenant identity, NDA, and IP restrictions stable while
    // admission is evaluated and committed.
    const lockedRoom = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT room."id"
        FROM "rooms" AS room
       WHERE room."id" = ${link.roomId}
         AND room."organizationId" = ${link.organizationId}
       FOR SHARE
    `);
    if (lockedRoom.length !== 1) {
      return deny('ROOM_MISMATCH', 404, 'This link is invalid');
    }

    const current = await tx.link.findFirst({
      where: {
        id: link.id,
        organizationId: link.organizationId,
        roomId: link.roomId,
      },
      select: linkPolicySelect,
    });
    if (!current) {
      return deny('LINK_NOT_FOUND', 404, 'This link is invalid');
    }

    const currentDecision = await evaluateLinkAdmission(current, input);
    if (!currentDecision.allowed) {
      return currentDecision;
    }
    if (!(await storedScopeExists(tx, current))) {
      return deny('LINK_SCOPE_INVALID', 404, 'This link is invalid');
    }

    // Re-read the trusted membership inside the locked admission transaction.
    // A browser body email is only asserted identity and never reaches this
    // branch as an NDA bypass.
    const authenticatedMember = input.authenticatedMember;
    const ndaOnFileApplied = Boolean(
      authenticatedMember &&
      authenticatedMember.organizationId === current.organizationId &&
      (
        await tx.userOrganization.findFirst({
          where: {
            organizationId: current.organizationId,
            userId: authenticatedMember.userId,
            isActive: true,
            archivedAt: null,
            user: { isActive: true, email: authenticatedMember.email },
          },
          select: { id: true, ndaOnFile: true },
        })
      )?.ndaOnFile
    );
    if (current.room.requiresNda && input.ndaAccepted !== true && !ndaOnFileApplied) {
      return deny('NDA_ACCEPTANCE_REQUIRED', 400, 'NDA acceptance is required');
    }

    await tx.link.update({
      where: { id: current.id },
      data: {
        viewCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    });

    const session = await tx.viewSession.create({
      data: {
        organizationId: current.organizationId,
        roomId: current.roomId,
        linkId: current.id,
        userId: ndaOnFileApplied ? authenticatedMember?.userId : null,
        sessionToken,
        visitorEmail: normalizedEmail,
        ipAddress: input.sourceIp === 'unknown' ? null : input.sourceIp,
        userAgent: input.userAgent,
      },
      select: { id: true },
    });

    await tx.linkVisit.create({
      data: {
        organizationId: current.organizationId,
        linkId: current.id,
        roomId: current.roomId,
        viewSessionId: session.id,
        visitorEmail: normalizedEmail,
        ipAddress: input.sourceIp === 'unknown' ? null : input.sourceIp,
        userAgent: input.userAgent,
      },
    });

    return { allowed: true, session, sessionToken, normalizedEmail, ndaOnFileApplied };
  });
}

/** Validate every gate that remains authoritative after session admission. */
export function evaluateLinkServe(
  shareToken: string,
  session: LinkServeSession | null,
  action: LinkPolicyAction = 'view',
  now = new Date()
): LinkPolicyDecision {
  if (
    !session ||
    !session.isActive ||
    !session.link ||
    !session.linkId ||
    session.linkId !== session.link.id ||
    session.link.slug !== shareToken
  ) {
    return deny('SESSION_INVALID', 401, 'Session expired or invalid');
  }
  if (!session.link.isActive) {
    return deny('LINK_INACTIVE', 401, 'Session expired or invalid');
  }
  if (
    session.organizationId !== session.link.organizationId ||
    session.organizationId !== session.link.room.organizationId ||
    session.roomId !== session.link.roomId ||
    session.roomId !== session.link.room.id
  ) {
    return deny('ORGANIZATION_MISMATCH', 401, 'Session expired or invalid');
  }
  if (!hasValidStoredScope(session.link)) {
    return deny('LINK_SCOPE_INVALID', 401, 'Session expired or invalid');
  }
  if (session.link.expiresAt && session.link.expiresAt <= now) {
    return deny('LINK_EXPIRED', 401, 'Session expired or invalid');
  }
  if (session.link.room.status !== 'ACTIVE') {
    return deny('ROOM_NOT_ACTIVE', 403, 'Room is not accessible');
  }
  if (session.link.maxSessionMinutes !== null) {
    const elapsedMs = now.getTime() - session.createdAt.getTime();
    if (elapsedMs >= session.link.maxSessionMinutes * 60_000) {
      return deny('SESSION_TIME_LIMIT_EXCEEDED', 403, 'Session time limit exceeded');
    }
  }
  if (action === 'download' && session.link.permission !== 'DOWNLOAD') {
    return deny(
      'LINK_PERMISSION_INSUFFICIENT',
      403,
      'This link is view-only; downloads are not permitted'
    );
  }
  return { allowed: true };
}

async function folderIsWithinScope(
  tx: Prisma.TransactionClient,
  roomId: string,
  candidateFolderId: string,
  scopedFolderId: string
): Promise<boolean> {
  let folderId: string | null = candidateFolderId;
  const visited = new Set<string>();

  while (folderId && !visited.has(folderId)) {
    visited.add(folderId);
    const folder: { parentId: string | null } | null = await tx.folder.findFirst({
      where: { id: folderId, roomId },
      select: { parentId: true },
    });
    if (!folder) {
      return false;
    }
    if (folderId === scopedFolderId) {
      return true;
    }
    folderId = folder.parentId;
  }

  return false;
}

/** Evaluate action and resource scope for a link after tenant identity is known. */
export async function canLinkAccessResource(
  tx: Prisma.TransactionClient,
  link: LinkScopeRecord & {
    organizationId: string;
    roomId: string;
    permission: LinkPermission;
    isActive: boolean;
    expiresAt: Date | null;
    room: { id: string; organizationId: string; status: string };
  },
  action: LinkPolicyAction,
  resource: LinkResourceTarget,
  now = new Date()
): Promise<boolean> {
  if (
    !link.isActive ||
    (link.expiresAt && link.expiresAt <= now) ||
    link.room.status !== 'ACTIVE' ||
    link.organizationId !== resource.organizationId ||
    link.room.organizationId !== resource.organizationId ||
    link.roomId !== resource.roomId ||
    link.room.id !== resource.roomId ||
    !hasValidStoredScope(link) ||
    (action === 'download' && link.permission !== 'DOWNLOAD')
  ) {
    return false;
  }

  if (link.scope === 'ENTIRE_ROOM') {
    return true;
  }
  if (link.scope === 'DOCUMENT') {
    return Boolean(resource.documentId && link.scopedDocumentId === resource.documentId);
  }
  if (!link.scopedFolderId || !resource.folderId) {
    return false;
  }
  return folderIsWithinScope(tx, resource.roomId, resource.folderId, link.scopedFolderId);
}

/** Backward-compatible document helper; all logic remains in this module. */
export async function canViewerLinkAccessDocument(
  tx: Prisma.TransactionClient,
  link: LinkScopeRecord,
  roomId: string,
  document: ViewerDocumentScopeTarget
): Promise<boolean> {
  if (link.scope === 'ENTIRE_ROOM') {
    return true;
  }
  if (link.scope === 'DOCUMENT') {
    return link.scopedDocumentId === document.id;
  }
  if (!link.scopedFolderId || !document.folderId) {
    return false;
  }
  return folderIsWithinScope(tx, roomId, document.folderId, link.scopedFolderId);
}

/**
 * Return the document IDs visible through a scoped link. Null means the entire
 * room is in scope. An empty set fails closed for a malformed or stale scope.
 */
export async function getViewerLinkScopedDocumentIds(
  tx: Prisma.TransactionClient,
  link: LinkScopeRecord,
  roomId: string
): Promise<Set<string> | null> {
  if (link.scope === 'ENTIRE_ROOM') {
    return null;
  }
  if (link.scope === 'DOCUMENT') {
    if (!link.scopedDocumentId) {
      return new Set();
    }
    const document = await tx.document.findFirst({
      where: {
        id: link.scopedDocumentId,
        roomId,
        status: 'ACTIVE',
        withdrawnAt: null,
      },
      select: { id: true },
    });
    return new Set(document ? [document.id] : []);
  }
  if (!link.scopedFolderId) {
    return new Set();
  }

  const scopeRoot = await tx.folder.findFirst({
    where: { id: link.scopedFolderId, roomId },
    select: { id: true },
  });
  if (!scopeRoot) {
    return new Set();
  }

  const folderIds = new Set([link.scopedFolderId]);
  let frontier = [link.scopedFolderId];
  while (frontier.length > 0) {
    const children = await tx.folder.findMany({
      where: { roomId, parentId: { in: frontier } },
      select: { id: true },
    });
    const next: string[] = [];
    for (const child of children) {
      if (!folderIds.has(child.id)) {
        folderIds.add(child.id);
        next.push(child.id);
      }
    }
    frontier = next;
  }

  const documents = await tx.document.findMany({
    where: {
      roomId,
      folderId: { in: [...folderIds] },
      status: 'ACTIVE',
      withdrawnAt: null,
    },
    select: { id: true },
  });
  return new Set(documents.map(({ id }) => id));
}

export function linkPermissionLevel(permission: LinkPermission): PermissionLevel {
  return permission === 'DOWNLOAD' ? 'DOWNLOAD' : 'VIEW';
}
