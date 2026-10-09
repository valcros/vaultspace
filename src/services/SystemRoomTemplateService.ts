import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, SystemRoomTemplate } from '@prisma/client';
import { z } from 'zod';

import { db } from '@/lib/db';
import {
  BUILT_IN_ROOM_TEMPLATES,
  getBuiltInRoomTemplate,
  resolveStarterFolderSelection,
  type StarterFolderDefinition,
} from '@/lib/rooms/starterFolderTemplates';

export class SystemRoomTemplateError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'SystemRoomTemplateError';
  }
}

export const systemRoomTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().max(2000).default(''),
    category: z.string().trim().min(1).max(100),
    enabled: z.boolean().default(true),
    folders: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(255),
            path: z.string().trim().max(2000),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((input, ctx) => {
    const selection = resolveStarterFolderSelection(input.folders);
    if (!selection.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['folders'], message: selection.error });
    }
    const siblings = new Set<string>();
    for (const folder of input.folders) {
      const parent = folder.path.slice(0, folder.path.lastIndexOf('/'));
      const key = JSON.stringify([parent, folder.name.toLocaleLowerCase('en-US')]);
      if (siblings.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['folders'],
          message: 'Sibling folder names must be unique',
        });
      }
      siblings.add(key);
    }
  });

export type SystemRoomTemplateInput = z.input<typeof systemRoomTemplateInputSchema>;
export interface ResolvedSystemRoomTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  isGlobal: true;
  isCustom: false;
  enabled: boolean;
  revision: string;
  structure: { folders: StarterFolderDefinition[] };
}
export interface SystemRoomTemplateActor {
  actorUserId: string;
  requestId: string;
}

/** Stable content revision, also usable for legacy tenant template snapshots. */
export function templateRevision(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (Array.isArray(item)) {
      return item.map(canonical);
    }
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, val]) => [key, canonical(val)])
      );
    }
    return item;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export function assertTemplateRevision(
  template: { revision: string },
  expectedRevision: string | undefined
): void {
  if (!expectedRevision || template.revision !== expectedRevision) {
    throw new SystemRoomTemplateError(409, 'The folder template changed. Refresh and try again.');
  }
}

function resolved(row: SystemRoomTemplate): ResolvedSystemRoomTemplate {
  const input = systemRoomTemplateInputSchema.parse({
    name: row.name,
    description: row.description,
    category: row.category,
    enabled: row.enabled,
    folders: row.folders,
  });
  const content = {
    id: row.id,
    name: input.name,
    description: input.description,
    category: input.category,
    isGlobal: true as const,
    isCustom: false as const,
    enabled: input.enabled,
    structure: { folders: input.folders },
  };
  return { ...content, revision: templateRevision({ ...content, rowRevision: row.revision }) };
}

function builtIn(id: string): ResolvedSystemRoomTemplate | null {
  const template = getBuiltInRoomTemplate(id);
  if (!template) {
    return null;
  }
  const content = { ...template, isCustom: false as const, enabled: true };
  return { ...content, revision: templateRevision({ ...content, source: 'builtin' }) };
}

function parseInput(input: SystemRoomTemplateInput) {
  const result = systemRoomTemplateInputSchema.safeParse(input);
  if (!result.success) {
    throw new SystemRoomTemplateError(
      400,
      result.error.issues[0]?.message ?? 'Invalid folder template'
    );
  }
  return result.data;
}

async function assertActor(tx: Prisma.TransactionClient, actor: SystemRoomTemplateActor) {
  const user = await tx.user.findUnique({
    where: { id: actor.actorUserId },
    select: { isActive: true, isPlatformOperator: true },
  });
  if (!user?.isActive || !user.isPlatformOperator) {
    throw new SystemRoomTemplateError(403, 'An active platform operator is required');
  }
  if (!actor.requestId) {
    throw new SystemRoomTemplateError(400, 'A request ID is required');
  }
}

async function audit(
  tx: Prisma.TransactionClient,
  row: SystemRoomTemplate,
  actor: SystemRoomTemplateActor,
  priorRevision: string | null
) {
  const template = resolved(row);
  await tx.systemRoomTemplateRevision.create({
    data: {
      templateId: row.id,
      revision: row.revision,
      actorUserId: actor.actorUserId,
      requestId: actor.requestId,
      snapshot: { ...template, priorRevision } as unknown as Prisma.InputJsonValue,
    },
  });
  return template;
}

export class SystemRoomTemplateService {
  async list(
    includeDisabled = false,
    tx?: Prisma.TransactionClient
  ): Promise<ResolvedSystemRoomTemplate[]> {
    // Read disabled overrides too: an archived builtin must never reappear.
    const rows = await (tx ?? db).systemRoomTemplate.findMany({ orderBy: { name: 'asc' } });
    const catalog = new Map(
      BUILT_IN_ROOM_TEMPLATES.map((template) => [template.id, builtIn(template.id)!])
    );
    for (const row of rows) {
      catalog.set(row.id, resolved(row));
    }
    return [...catalog.values()]
      .filter((template) => includeDisabled || template.enabled)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string, tx?: Prisma.TransactionClient): Promise<ResolvedSystemRoomTemplate | null> {
    const row = await (tx ?? db).systemRoomTemplate.findUnique({ where: { id } });
    return row ? resolved(row) : builtIn(id);
  }

  async create(
    input: SystemRoomTemplateInput,
    actor: SystemRoomTemplateActor
  ): Promise<ResolvedSystemRoomTemplate> {
    const data = parseInput(input);
    return db.$transaction(async (tx) => {
      await assertActor(tx, actor);
      const row = await tx.systemRoomTemplate.create({
        data: { ...data, id: `sys-${randomUUID()}` },
      });
      return audit(tx, row, actor, null);
    });
  }

  async update(
    id: string,
    input: SystemRoomTemplateInput,
    expectedRevision: string | undefined,
    actor: SystemRoomTemplateActor
  ): Promise<ResolvedSystemRoomTemplate> {
    const data = parseInput(input);
    try {
      return await db.$transaction(async (tx) => {
        await assertActor(tx, actor);
        const row = await tx.systemRoomTemplate.findUnique({ where: { id } });
        const current = row ? resolved(row) : builtIn(id);
        if (!current) {
          throw new SystemRoomTemplateError(404, 'Folder template not found');
        }
        assertTemplateRevision(current, expectedRevision);
        if (!row) {
          const created = await tx.systemRoomTemplate.create({ data: { ...data, id } });
          return audit(tx, created, actor, current.revision);
        }
        const updated = await tx.systemRoomTemplate.updateMany({
          where: { id, revision: row.revision },
          data: { ...data, revision: { increment: 1 } },
        });
        if (updated.count !== 1) {
          throw new SystemRoomTemplateError(
            409,
            'The folder template changed. Refresh and try again.'
          );
        }
        // Use the exact content written by this CAS, without a second read.
        return audit(tx, { ...row, ...data, revision: row.revision + 1 }, actor, current.revision);
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw new SystemRoomTemplateError(
          409,
          'The folder template changed. Refresh and try again.'
        );
      }
      throw error;
    }
  }
}

export const systemRoomTemplateService = new SystemRoomTemplateService();
