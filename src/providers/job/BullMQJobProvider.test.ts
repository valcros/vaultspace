import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const queueAdd = vi.fn();
  const queueClose = vi.fn();
  const queueWaitUntilReady = vi.fn();
  const queueConstructor = vi.fn(() => ({
    add: queueAdd,
    close: queueClose,
    waitUntilReady: queueWaitUntilReady,
  }));

  return { queueAdd, queueClose, queueWaitUntilReady, queueConstructor };
});

vi.mock('bullmq', () => ({
  Queue: mocks.queueConstructor,
  Job: {
    fromId: vi.fn(),
  },
}));

import { BullMQJobProvider } from './BullMQJobProvider';

describe('BullMQJobProvider', () => {
  beforeEach(() => {
    mocks.queueAdd.mockReset();
    mocks.queueAdd.mockResolvedValue({ id: 'job-1' });
    mocks.queueClose.mockReset();
    mocks.queueWaitUntilReady.mockReset();
    mocks.queueWaitUntilReady.mockResolvedValue(undefined);
    mocks.queueConstructor.mockClear();
  });

  it('establishes queue connectivity on demand', async () => {
    const provider = new BullMQJobProvider({ redisUrl: 'redis://localhost:6379' });

    await provider.waitUntilReady('normal');

    expect(mocks.queueWaitUntilReady).toHaveBeenCalledOnce();
  });

  it('does not set BullMQ priority unless explicitly requested', async () => {
    const provider = new BullMQJobProvider({
      redisUrl: 'redis://localhost:6379',
    });

    await provider.addJob('normal', 'email.send', { ok: true });

    const addOptions = mocks.queueAdd.mock.calls[0]?.[2];
    expect(addOptions).not.toHaveProperty('priority');
    expect(addOptions).not.toHaveProperty('attempts');
    expect(addOptions).not.toHaveProperty('backoff');
    expect(addOptions).not.toHaveProperty('delay');
    expect(mocks.queueAdd).toHaveBeenCalledWith('email.send', { ok: true }, addOptions);
  });

  it('maps explicit app priority to BullMQ priority', async () => {
    const provider = new BullMQJobProvider({
      redisUrl: 'redis://localhost:6379',
    });

    await provider.addJob('high', 'document.scan', { documentId: 'doc-1' }, { priority: 'high' });

    expect(mocks.queueAdd.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        priority: 1,
      })
    );
  });

  it('passes an explicit password-reset retry policy without undefined overrides', async () => {
    const provider = new BullMQJobProvider({ redisUrl: 'redis://localhost:6379' });

    await provider.addJob(
      'normal',
      'email.send',
      { flowId: 'flow-1' },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
        jobId: 'password-reset-flow-1',
        removeOnComplete: true,
        removeOnFail: true,
      }
    );

    expect(mocks.queueAdd.mock.calls[0]?.[2]).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
      jobId: 'password-reset-flow-1',
      removeOnComplete: true,
      removeOnFail: true,
    });
  });

  it('rejects custom IDs containing BullMQ reserved separators before queue insertion', async () => {
    const provider = new BullMQJobProvider({ redisUrl: 'redis://localhost:6379' });

    await expect(
      provider.addJob(
        'normal',
        'password-reset.deliver',
        { flowId: 'flow-1' },
        { jobId: 'password-reset:flow-1:delivery:1' }
      )
    ).rejects.toThrow(/must not contain a colon/i);
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });
});
