import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { isAuthenticationError, RateLimitError } from '@/lib/errors';
import { getRequestContext, rateLimiters, requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;

class DiagnosticPayloadTooLargeError extends Error {}
class InvalidContentLengthError extends Error {}

async function readBoundedJson(request: NextRequest): Promise<unknown> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new InvalidContentLengthError();
    }
    if (Number(declaredLength) > MAX_BODY_BYTES) {
      throw new DiagnosticPayloadTooLargeError();
    }
  }

  if (!request.body) {
    return JSON.parse('');
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // Cancellation is best effort. The deterministic result for an
        // oversized payload remains 413 even if the stream source rejects it.
      }
      throw new DiagnosticPayloadTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder().decode(body));
}

const clientErrorSchema = z
  .object({
    pathname: z
      .string()
      .min(1)
      .max(500)
      .refine((value) => value.startsWith('/') && !value.includes('?') && !value.includes('#')),
    errorName: z.string().min(1).max(100),
    digest: z.string().max(200).optional(),
    clientRelease: z.string().max(100).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin');
    if (!origin || origin !== request.nextUrl.origin) {
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
    }

    const session = await requireAuth();
    await rateLimiters.clientDiagnosticsByUser(session.userId);
    const reqContext = getRequestContext(request);
    const body = clientErrorSchema.parse(await readBoundedJson(request));

    console.error(
      JSON.stringify({
        component: 'client-diagnostics',
        event: 'client_render_error',
        outcome: 'failed',
        requestId: reqContext.requestId,
        userId: session.userId,
        organizationId: session.organizationId,
        authSessionId: session.sessionId,
        pathname: body.pathname,
        errorName: body.errorName,
        digest: body.digest ?? null,
        clientRelease: body.clientRelease ?? null,
        serverRevision:
          process.env['CONTAINER_APP_REVISION'] ?? process.env['NEXT_PUBLIC_APP_RELEASE'] ?? null,
      })
    );

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof DiagnosticPayloadTooLargeError) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    if (error instanceof InvalidContentLengthError) {
      return NextResponse.json({ error: 'Invalid Content-Length' }, { status: 400 });
    }
    if (isAuthenticationError(error)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'Too many diagnostic reports' },
        { status: 429, headers: { 'Retry-After': String(error.retryAfter) } }
      );
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid diagnostic payload' }, { status: 400 });
    }

    console.error(
      JSON.stringify({
        component: 'client-diagnostics',
        event: 'diagnostic_ingestion',
        outcome: 'failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
    );
    return NextResponse.json({ error: 'Diagnostic ingestion failed' }, { status: 500 });
  }
}
