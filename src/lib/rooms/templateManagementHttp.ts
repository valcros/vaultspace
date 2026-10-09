import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import {
  systemRoomTemplateInputSchema,
  SystemRoomTemplateError,
} from '@/services/SystemRoomTemplateService';

const requestSchema = z
  .object({
    name: z.unknown(),
    description: z.unknown().optional(),
    category: z.unknown(),
    enabled: z.unknown().optional(),
    structure: z.object({ folders: z.unknown() }).strict(),
    expectedRevision: z.string().min(1).max(100).optional(),
  })
  .strict();

export async function readTemplateInput(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) {
    throw new SystemRoomTemplateError(400, 'A template is required');
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      length += value.byteLength;
      if (length > 131072) {
        await reader.cancel();
        throw new SystemRoomTemplateError(413, 'Template request is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new SystemRoomTemplateError(400, 'Request body must be valid JSON');
  }
  const parsed = requestSchema.parse(value);
  return {
    input: systemRoomTemplateInputSchema.parse({
      name: parsed.name,
      description: parsed.description,
      category: parsed.category,
      enabled: parsed.enabled,
      folders: parsed.structure.folders,
    }),
    expectedRevision: parsed.expectedRevision,
  };
}

export function templateHttpError(error: unknown) {
  if (error instanceof AuthenticationError) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { error: 'Platform operator access required or access policy denied' },
      { status: 403 }
    );
  }
  if (error instanceof SystemRoomTemplateError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message ?? 'Invalid template' },
      { status: 400 }
    );
  }
  return NextResponse.json({ error: 'Unable to process system folder templates' }, { status: 500 });
}
