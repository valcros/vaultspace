import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const queueAdd = vi.fn();
  const queueClose = vi.fn();
  const queueConstructor = vi.fn(() => ({
    add: queueAdd,
    close: queueClose,
  }));

  return { queueAdd, queueClose, queueConstructor };
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
    mocks.queueConstructor.mockClear();
  });

  it('does not set BullMQ priority unless explicitly requested', async () => {
    const provider = new BullMQJobProvider({
      redisUrl: 'redis://localhost:6379',
    });

    await provider.addJob('normal', 'email.send', { ok: true });

    const addOptions = mocks.queueAdd.mock.calls[0]?.[2];
    expect(addOptions).not.toHaveProperty('priority');
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
});
