/**
 * Reset Password API (F004)
 *
 * POST /api/auth/reset-password - Reset password with token
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

import { clearSessionCache } from '@/lib/auth';
import { createSecurityAuditEvent } from '@/lib/audit/securityAudit';
import {
  PasswordResetCapabilityRepository,
  passwordResetCapabilityRepository,
} from '@/lib/auth/passwordResetCapabilityRepository';
import { resolvePasswordResetTokenLookup } from '@/lib/auth/passwordResetToken';
import { db, setBootstrapContext, setTransactionOrganizationContext } from '@/lib/db';
import { getRequestContext } from '@/lib/middleware';
import { z } from 'zod';

const INVALID_RESET_TOKEN_MESSAGE = 'Invalid or expired password reset token';

const resetPasswordSchema = z.object({
  token: z.string().min(1, INVALID_RESET_TOKEN_MESSAGE).max(128, INVALID_RESET_TOKEN_MESSAGE),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

function invalidResetTokenResponse() {
  return NextResponse.json({ error: INVALID_RESET_TOKEN_MESSAGE }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const reqContext = getRequestContext(request);
  const ipAddress = reqContext.ipAddress === 'unknown' ? null : reqContext.ipAddress;
  const userAgent = reqContext.userAgent === 'unknown' ? null : reqContext.userAgent;

  try {
    const body = await request.json();
    const { token, password } = resetPasswordSchema.parse(body);
    const tokenLookup = resolvePasswordResetTokenLookup(token);

    if (!tokenLookup) {
      console.warn(
        JSON.stringify({
          component: 'reset-password',
          event: 'token_validation',
          outcome: 'rejected',
          requestId: reqContext.requestId,
          errorCode: 'INVALID_OR_EXPIRED_TOKEN',
        })
      );
      return invalidResetTokenResponse();
    }

    // Reject invalid, used, expired, or inactive capabilities before cost-12
    // hashing. The candidate function returns only a proof marker and no
    // identity or reset-flow metadata.
    const candidateProven = await passwordResetCapabilityRepository.candidateProven(
      tokenLookup.storedToken
    );
    if (!candidateProven) {
      console.warn(
        JSON.stringify({
          component: 'reset-password',
          event: 'token_validation',
          outcome: 'rejected',
          requestId: reqContext.requestId,
          errorCode: 'INVALID_OR_EXPIRED_TOKEN',
        })
      );
      return invalidResetTokenResponse();
    }

    // Candidate proof is deliberately non-authoritative. Redemption repeats
    // every eligibility check under the account advisory and row locks.
    const passwordHash = await bcrypt.hash(password, 12);

    const redemption = await db.$transaction(
      async (tx) => {
        await setBootstrapContext(tx);
        const transactionRepository = new PasswordResetCapabilityRepository(tx);
        const result = await transactionRepository.redeem(tokenLookup.storedToken, passwordHash);
        if (!result) {
          return null;
        }

        for (const auditOrganization of result.auditOrganizations) {
          await setTransactionOrganizationContext(tx, auditOrganization.organizationId);

          await createSecurityAuditEvent(tx, {
            organizationId: auditOrganization.organizationId,
            eventType: 'USER_PASSWORD_RESET',
            actorType: auditOrganization.actorType,
            actorId: result.subjectUserId,
            actorEmail: result.subjectEmail,
            requestId: reqContext.requestId,
            correlationId: result.flowId,
            idempotencyKey: `password-reset-${result.flowId}-completed-${auditOrganization.organizationId}`,
            description: 'User completed a password reset',
            metadata: {
              outcome: 'success',
              stage: 'completed',
              invalidatedSessionCount: result.revokedSessionIds.length,
              initiationRequestId: result.initiationRequestId,
            },
            ipAddress,
            userAgent,
          });

          for (const superseded of result.supersededFlows) {
            await createSecurityAuditEvent(tx, {
              organizationId: auditOrganization.organizationId,
              eventType: 'USER_PASSWORD_RESET',
              actorType: auditOrganization.actorType,
              actorId: result.subjectUserId,
              actorEmail: result.subjectEmail,
              requestId: superseded.requestId ?? `recovery-${superseded.flowId}`,
              correlationId: superseded.flowId,
              idempotencyKey: `password-reset-${superseded.flowId}-superseded-${auditOrganization.organizationId}`,
              description: 'Password reset flow was superseded by successful password redemption',
              metadata: {
                outcome: 'cancelled',
                stage: 'redemption_supersession',
                replacementFlowId: result.flowId,
                errorCode: 'SUPERSEDED',
              },
              ipAddress,
              userAgent,
            });
          }
        }

        return result;
      },
      { maxWait: 5_000, timeout: 30_000 }
    );

    if (!redemption) {
      return invalidResetTokenResponse();
    }

    try {
      await clearSessionCache(redemption.revokedSessionIds);
    } catch (error) {
      console.error(
        JSON.stringify({
          component: 'reset-password',
          event: 'revoked_session_cache_delete',
          outcome: 'failed',
          requestId: reqContext.requestId,
          requestedCount: redemption.revokedSessionIds.length,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        })
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        component: 'reset-password',
        event: 'password_reset_completed',
        outcome: 'success',
        requestId: reqContext.requestId,
        correlationId: redemption.flowId,
        invalidatedSessionCount: redemption.revokedSessionIds.length,
      })
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      if (error.issues.some((issue) => issue.path[0] === 'token')) {
        return invalidResetTokenResponse();
      }

      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    console.error(
      JSON.stringify({
        component: 'reset-password',
        event: 'request_processing',
        outcome: 'failed',
        requestId: reqContext.requestId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
    );
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }
}
