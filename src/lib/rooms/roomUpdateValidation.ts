import { z } from 'zod';

import { isValidIpOrCidr } from '@/lib/utils/ip';

const httpsUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', {
    message: 'URL must use HTTPS',
  });

const ipv4OrCidr = z
  .string()
  .trim()
  .refine(isValidIpOrCidr, { message: 'Must be an IPv4 address or IPv4 CIDR range' });

/**
 * The update contract shared by both authenticated room-update endpoints.
 * Keep enforcement here so a legacy settings path cannot accept values that
 * the primary lifecycle endpoint rejects.
 */
export const roomUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(10_000).nullable().optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED', 'CLOSED']).optional(),
    allowDownloads: z.boolean().optional(),
    allowViewerVersionHistory: z.boolean().optional(),
    defaultExpiryDays: z.number().int().min(1).max(365).nullable().optional(),
    requiresPassword: z.boolean().optional(),
    requiresEmailVerification: z.boolean().optional(),
    enableWatermark: z.boolean().optional(),
    watermarkTemplate: z.string().max(500).nullable().optional(),
    requiresNda: z.boolean().optional(),
    ndaContent: z.string().max(10_000).nullable().optional(),
    allDocumentsConfidential: z.boolean().optional(),
    brandColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .nullable()
      .optional(),
    brandLogoUrl: httpsUrl.nullable().optional(),
    ipAllowlist: z.array(ipv4OrCidr).max(100).optional(),
  })
  .strict();
