import type { Prisma } from '@prisma/client';
import { readTemplateFolders } from './starterFolderTemplates';
import {
  systemRoomTemplateService,
  SystemRoomTemplateError,
  assertTemplateRevision,
  templateRevision,
} from '@/services/SystemRoomTemplateService';

/** Legacy tenant templates remain tenant-owned; their flags never grant global access. */
export function legacyTemplateProjection(template: {
  id: string;
  name: string;
  description: string | null;
  category: string;
  folderStructure: unknown;
}) {
  const folders = readTemplateFolders(template.folderStructure);
  if (!folders) {
    throw new SystemRoomTemplateError(400, 'Template has an invalid folder structure');
  }
  const value = {
    id: template.id,
    name: template.name,
    description: template.description ?? '',
    category: template.category,
    structure: { folders },
  };
  return { ...value, isCustom: true, enabled: true, revision: templateRevision(value) };
}

/** Selection is validated against one catalog snapshot within the room mutation transaction. */
export async function resolveRoomTemplate(
  tx: Prisma.TransactionClient,
  organizationId: string,
  id: string,
  revision?: string
) {
  const system = await systemRoomTemplateService.get(id, tx);
  if (system) {
    if (!system.enabled) {
      throw new SystemRoomTemplateError(
        409,
        'This template is disabled. Reload the folder templates.'
      );
    }
    assertTemplateRevision(system, revision);
    return system;
  }
  const legacy = await tx.roomTemplate.findFirst({ where: { id, organizationId } });
  if (!legacy) {
    throw new SystemRoomTemplateError(404, 'Selected template was not found');
  }
  const template = legacyTemplateProjection(legacy);
  assertTemplateRevision(template, revision);
  return template;
}
