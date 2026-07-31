import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import {
  AcsEventGridConfigurationError,
  canonicalEventGridTopic,
  resolveAcsEventGridConfiguration,
  type AcsEventGridConfiguration,
  type AcsEventGridSource,
} from '@/lib/integrations/acsEventGridConfig';
import {
  authenticateEventGridRequest,
  EventGridAuthenticationError,
} from '@/lib/integrations/eventGridAuth';
import {
  payloadFingerprint,
  stableEventFingerprint,
} from '@/lib/integrations/eventGridFingerprint';
import { recordProviderEventConflict } from '@/lib/integrations/providerEventInbox';
import { providerIngressDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_BATCH_EVENTS = 1;
const DELIVERY_EVENT_TYPE = 'Microsoft.Communication.EmailDeliveryReportReceived';
const VALIDATION_EVENT_TYPE = 'Microsoft.EventGrid.SubscriptionValidationEvent';
const KNOWN_STATUSES = new Set([
  'Delivered',
  'Suppressed',
  'Bounced',
  'Quarantined',
  'FilteredSpam',
  'Expanded',
  'Failed',
]);

class IngestionRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 404 | 413 | 415 | 503
  ) {
    super(code);
    this.name = 'IngestionRequestError';
  }
}

interface NormalizedReceipt {
  rawEvent: Record<string, unknown>;
  provider: 'acs';
  eventType: string;
  eventIdFingerprint: string;
  payloadFingerprint: string;
  payloadFingerprintKeyId: string;
  topicFingerprint: string;
  providerMessageId: string | null;
  providerStatus: string | null;
  dataVersion: string;
  metadataVersion: string;
  eventAt: Date;
  deliveryAttemptAt: Date | null;
  processingStatus: 'PENDING' | 'QUARANTINED';
  lastErrorCode: string | null;
  quarantineReasonCodes: string[];
}

function log(level: 'info' | 'warn' | 'error', fields: Record<string, unknown>): void {
  const line = JSON.stringify({ component: 'acs-event-grid-ingress', ...fields });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console -- structured operational event without request payload data
    console.log(line);
  }
}

async function readBoundedBody(request: NextRequest): Promise<string> {
  const declaredLength = request.headers.get('content-length');
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)
  ) {
    throw new IngestionRequestError('EVENT_GRID_BODY_TOO_LARGE', 413);
  }
  if (!request.body) {
    throw new IngestionRequestError('EVENT_GRID_BODY_MISSING', 400);
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new IngestionRequestError('EVENT_GRID_BODY_TOO_LARGE', 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof IngestionRequestError) {
      throw error;
    }
    throw new IngestionRequestError('EVENT_GRID_BODY_ENCODING_INVALID', 400);
  }
  return body;
}

function asRecord(value: unknown, code = 'EVENT_GRID_EVENT_INVALID'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IngestionRequestError(code, 400);
  }
  return value as Record<string, unknown>;
}

function boundedString(
  value: unknown,
  maxLength: number,
  code: string,
  optional = false
): string | null {
  if (optional && (value === undefined || value === null || value === '')) {
    return null;
  }
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new IngestionRequestError(code, 400);
  }
  return value.trim();
}

function parseDate(value: unknown, code: string, optional = false): Date | null {
  const raw = boundedString(value, 64, code, optional);
  if (raw === null) {
    return null;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() < 2020) {
    throw new IngestionRequestError(code, 400);
  }
  return parsed;
}

function matchingSource(
  subscriptionName: string,
  topic: string,
  configuration: AcsEventGridConfiguration
): AcsEventGridSource | undefined {
  const canonicalTopic = canonicalEventGridTopic(topic);
  return configuration.sources.find(
    (source) => source.subscriptionName === subscriptionName && source.topic === canonicalTopic
  );
}

function parseEventBatch(body: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new IngestionRequestError('EVENT_GRID_JSON_INVALID', 400);
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_BATCH_EVENTS) {
    throw new IngestionRequestError('EVENT_GRID_BATCH_INVALID', 400);
  }
  return parsed.map((event) => asRecord(event));
}

function normalizeReceipt(
  event: Record<string, unknown>,
  source: AcsEventGridSource,
  configuration: AcsEventGridConfiguration
): NormalizedReceipt {
  const eventType = boundedString(event['eventType'], 100, 'EVENT_GRID_EVENT_TYPE_INVALID')!;
  if (eventType !== DELIVERY_EVENT_TYPE) {
    throw new IngestionRequestError('EVENT_GRID_EVENT_TYPE_UNSUPPORTED', 400);
  }
  const topic = boundedString(event['topic'], 500, 'EVENT_GRID_TOPIC_INVALID')!;
  if (canonicalEventGridTopic(topic) !== source.topic) {
    throw new IngestionRequestError('EVENT_GRID_SOURCE_FORBIDDEN', 400);
  }
  const eventId = boundedString(event['id'], 200, 'EVENT_GRID_EVENT_ID_INVALID')!;
  const dataVersion = boundedString(event['dataVersion'], 16, 'EVENT_GRID_DATA_VERSION_INVALID')!;
  const metadataVersion = boundedString(
    event['metadataVersion'],
    16,
    'EVENT_GRID_METADATA_VERSION_INVALID'
  )!;
  const data = asRecord(event['data'], 'EVENT_GRID_DATA_INVALID');
  const messageId = boundedString(data['messageId'], 255, 'EVENT_GRID_MESSAGE_ID_INVALID', true);
  const rawStatus = boundedString(data['status'], 32, 'EVENT_GRID_STATUS_INVALID', true);
  const firstAttempt = data['deliveryAttemptTimeStamp'];
  const secondAttempt = data['deliveryAttemptTimestamp'];
  if (firstAttempt !== undefined && secondAttempt !== undefined && firstAttempt !== secondAttempt) {
    throw new IngestionRequestError('EVENT_GRID_DELIVERY_TIMESTAMP_CONFLICT', 400);
  }
  const deliveryAttemptAt = parseDate(
    firstAttempt ?? secondAttempt,
    'EVENT_GRID_DELIVERY_TIMESTAMP_INVALID',
    true
  );
  const eventAt = parseDate(event['eventTime'], 'EVENT_GRID_EVENT_TIME_INVALID')!;
  const unknownStatus = rawStatus !== null && !KNOWN_STATUSES.has(rawStatus);
  const quarantineReasonCodes: string[] = [];
  if (!messageId) {
    quarantineReasonCodes.push('PROVIDER_MESSAGE_ID_MISSING');
  }
  if (!rawStatus) {
    quarantineReasonCodes.push('PROVIDER_STATUS_MISSING');
  } else if (unknownStatus) {
    quarantineReasonCodes.push('PROVIDER_STATUS_UNSUPPORTED');
  }
  if (dataVersion !== '1.0' || metadataVersion !== '1') {
    quarantineReasonCodes.push('EVENT_GRID_VERSION_UNSUPPORTED');
  }
  const lastErrorCode = quarantineReasonCodes[0] ?? null;
  const activeKey = configuration.fingerprintKeys.get(configuration.activeFingerprintKeyId)!;
  const canonicalData = { ...data };
  delete canonicalData['deliveryAttemptTimeStamp'];
  delete canonicalData['deliveryAttemptTimestamp'];
  if (firstAttempt !== undefined || secondAttempt !== undefined) {
    canonicalData['deliveryAttemptTimestamp'] = deliveryAttemptAt?.toISOString() ?? null;
  }
  const fingerprintEvent = {
    ...event,
    id: eventId,
    topic: source.topic,
    eventType,
    eventTime: eventAt.toISOString(),
    dataVersion,
    metadataVersion,
    data: canonicalData,
  };
  let fingerprint: string;
  try {
    fingerprint = payloadFingerprint(fingerprintEvent, activeKey);
  } catch {
    throw new IngestionRequestError('EVENT_GRID_EVENT_COMPLEXITY_INVALID', 400);
  }
  return {
    rawEvent: fingerprintEvent,
    provider: 'acs',
    eventType,
    eventIdFingerprint: stableEventFingerprint(eventId),
    payloadFingerprint: fingerprint,
    payloadFingerprintKeyId: configuration.activeFingerprintKeyId,
    topicFingerprint: stableEventFingerprint(source.topic),
    providerMessageId: messageId,
    providerStatus: unknownStatus ? null : rawStatus,
    dataVersion,
    metadataVersion,
    eventAt,
    deliveryAttemptAt,
    processingStatus: quarantineReasonCodes.length > 0 ? 'QUARANTINED' : 'PENDING',
    lastErrorCode,
    quarantineReasonCodes,
  };
}

async function persistReceipts(
  receipts: NormalizedReceipt[],
  configuration: AcsEventGridConfiguration
): Promise<{ accepted: number; duplicates: number; conflicts: number; quarantined: number }> {
  return providerIngressDb.$transaction(
    async (tx) => {
      const summary = { accepted: 0, duplicates: 0, conflicts: 0, quarantined: 0 };
      for (const receipt of receipts) {
        const inserted = await tx.providerEventInbox.createMany({
          data: {
            provider: receipt.provider,
            eventType: receipt.eventType,
            eventIdFingerprint: receipt.eventIdFingerprint,
            payloadFingerprint: receipt.payloadFingerprint,
            payloadFingerprintKeyId: receipt.payloadFingerprintKeyId,
            topicFingerprint: receipt.topicFingerprint,
            providerMessageId: receipt.providerMessageId,
            providerStatus: receipt.providerStatus,
            dataVersion: receipt.dataVersion,
            metadataVersion: receipt.metadataVersion,
            eventAt: receipt.eventAt,
            deliveryAttemptAt: receipt.deliveryAttemptAt,
            processingStatus: receipt.processingStatus,
            lastErrorCode: receipt.lastErrorCode,
            quarantineReasonCodes: receipt.quarantineReasonCodes,
          },
          skipDuplicates: true,
        });
        const stored = await tx.providerEventInbox.findUniqueOrThrow({
          where: {
            provider_eventIdFingerprint: {
              provider: receipt.provider,
              eventIdFingerprint: receipt.eventIdFingerprint,
            },
          },
        });
        const originalKey = configuration.fingerprintKeys.get(stored.payloadFingerprintKeyId);
        if (!originalKey) {
          throw new AcsEventGridConfigurationError('EVENT_GRID_PAYLOAD_FINGERPRINT_KEY_MISSING');
        }
        const comparableFingerprint = payloadFingerprint(receipt.rawEvent, originalKey);
        if (stored.payloadFingerprint === comparableFingerprint) {
          if (inserted.count === 1) {
            summary.accepted += 1;
          } else {
            summary.duplicates += 1;
          }
          if (stored.processingStatus === 'QUARANTINED') {
            summary.quarantined += 1;
          }
          continue;
        }
        await recordProviderEventConflict(tx, stored.id, comparableFingerprint);
        summary.conflicts += 1;
      }
      return summary;
    },
    { maxWait: 2_000, timeout: 5_000 }
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const configuration = resolveAcsEventGridConfiguration();
    if (!configuration.enabled) {
      throw new IngestionRequestError('EVENT_GRID_INGESTION_DISABLED', 404);
    }
    await authenticateEventGridRequest(request.headers.get('authorization'), configuration);

    const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
    if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
      throw new IngestionRequestError('EVENT_GRID_CONTENT_TYPE_INVALID', 415);
    }
    const contentEncoding = request.headers.get('content-encoding');
    if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
      throw new IngestionRequestError('EVENT_GRID_CONTENT_ENCODING_UNSUPPORTED', 415);
    }
    const subscriptionName = boundedString(
      request.headers.get('aeg-subscription-name'),
      100,
      'EVENT_GRID_SUBSCRIPTION_INVALID'
    )!;
    const eventHeader = boundedString(
      request.headers.get('aeg-event-type'),
      32,
      'EVENT_GRID_HEADER_TYPE_INVALID'
    )!;
    const events = parseEventBatch(await readBoundedBody(request));

    if (eventHeader === 'SubscriptionValidation') {
      if (events.length !== 1 || events[0]!['eventType'] !== VALIDATION_EVENT_TYPE) {
        throw new IngestionRequestError('EVENT_GRID_VALIDATION_SHAPE_INVALID', 400);
      }
      const topic = boundedString(events[0]!['topic'], 500, 'EVENT_GRID_TOPIC_INVALID')!;
      if (!matchingSource(subscriptionName, topic, configuration)) {
        throw new IngestionRequestError('EVENT_GRID_SOURCE_FORBIDDEN', 400);
      }
      const validationData = asRecord(events[0]!['data'], 'EVENT_GRID_VALIDATION_DATA_INVALID');
      const validationCode = boundedString(
        validationData['validationCode'],
        200,
        'EVENT_GRID_VALIDATION_CODE_INVALID'
      )!;
      log('info', { event: 'subscription_validation', outcome: 'accepted', requestId });
      return NextResponse.json(
        { validationResponse: validationCode },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (eventHeader !== 'Notification') {
      throw new IngestionRequestError('EVENT_GRID_HEADER_TYPE_UNSUPPORTED', 400);
    }
    const firstTopic = boundedString(events[0]!['topic'], 500, 'EVENT_GRID_TOPIC_INVALID')!;
    const source = matchingSource(subscriptionName, firstTopic, configuration);
    if (!source) {
      throw new IngestionRequestError('EVENT_GRID_SOURCE_FORBIDDEN', 400);
    }
    const receipts = events.map((event) => normalizeReceipt(event, source, configuration));
    const summary = await persistReceipts(receipts, configuration);
    log('info', {
      event: 'delivery_receipts',
      outcome: summary.conflicts > 0 ? 'conflict_recorded' : 'accepted',
      requestId,
      batchSize: receipts.length,
      ...summary,
    });
    return NextResponse.json(summary, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const handled =
      error instanceof EventGridAuthenticationError ||
      error instanceof IngestionRequestError ||
      error instanceof AcsEventGridConfigurationError;
    const status =
      error instanceof EventGridAuthenticationError
        ? error.status
        : error instanceof IngestionRequestError
          ? error.status
          : 503;
    const code = handled && 'code' in error ? error.code : 'EVENT_GRID_INGESTION_UNAVAILABLE';
    log(status >= 500 ? 'error' : 'warn', {
      event: 'request_rejected',
      outcome: 'rejected',
      requestId,
      errorCode: code,
      status,
    });
    return NextResponse.json(
      { error: status >= 500 ? 'Service unavailable' : 'Request rejected' },
      { status, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
