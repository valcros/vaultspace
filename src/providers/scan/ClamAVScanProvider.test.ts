import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const socketState = vi.hoisted(() => ({
  sockets: [] as Array<
    EventEmitter & {
      setTimeout: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      connect: ReturnType<typeof vi.fn>;
    }
  >,
}));

vi.mock('net', () => ({
  Socket: vi.fn(() => {
    const socket = Object.assign(new EventEmitter(), {
      setTimeout: vi.fn(),
      write: vi.fn(),
      destroy: vi.fn(),
      connect: vi.fn(function connect(this: EventEmitter) {
        queueMicrotask(() => this.emit('connect'));
        return this;
      }),
    });

    socketState.sockets.push(socket);
    return socket;
  }),
}));

import { ClamAVScanProvider } from './ClamAVScanProvider';

describe('ClamAVScanProvider', () => {
  beforeEach(() => {
    socketState.sockets.length = 0;
  });

  it('treats null-terminated PONG as available', async () => {
    const provider = new ClamAVScanProvider({ host: 'localhost', port: 3310 });
    const result = provider.isAvailable();

    await vi.waitFor(() => {
      expect(socketState.sockets[0]?.write).toHaveBeenCalledWith('zPING\0');
    });

    socketState.sockets[0]?.emit('data', Buffer.from('PONG\0'));

    await expect(result).resolves.toBe(true);
    expect(socketState.sockets[0]?.destroy).toHaveBeenCalled();
  });

  async function scanWithResponse(response: string, data = Buffer.from('x')) {
    const provider = new ClamAVScanProvider({ host: 'localhost', port: 3310 });
    const result = provider.scan(data);
    await vi.waitFor(() => {
      expect(socketState.sockets[0]?.write).toHaveBeenCalled();
    });
    socketState.sockets[0]?.emit('data', Buffer.from(response));
    socketState.sockets[0]?.emit('end');
    return result;
  }

  it('reports a threat even when the signature name contains "OK"', async () => {
    const r = await scanWithResponse('stream: Win.Test.OK-Malware FOUND\0');
    expect(r.clean).toBe(false);
    expect(r.threats).toEqual(['Win.Test.OK-Malware']);
    expect(r.skipped).toBeFalsy();
  });

  it('treats only an exact "stream: OK" as clean', async () => {
    const r = await scanWithResponse('stream: OK\0');
    expect(r.clean).toBe(true);
    expect(r.skipped).toBeFalsy();
  });

  it('treats a clamd INSTREAM size-limit error as skipped (allowed, unscanned)', async () => {
    const r = await scanWithResponse('INSTREAM size limit exceeded\0');
    expect(r.skipped).toBe(true);
    expect(r.clean).toBe(true);
    expect(r.threats).toBeUndefined();
  });

  it('throws on an unexpected/malformed response rather than guessing', async () => {
    await expect(scanWithResponse('some garbage response\0')).rejects.toThrow(
      /Unexpected ClamAV response/
    );
  });

  it('skips (does not flag as a threat) a file larger than the scan limit', async () => {
    const provider = new ClamAVScanProvider({ host: 'localhost', port: 3310, maxSize: 4 });
    const r = await provider.scan(Buffer.from('this-is-way-too-large'));
    expect(r.skipped).toBe(true);
    expect(r.clean).toBe(true);
    expect(r.threats).toBeUndefined();
    // No socket should be opened for an oversize file (returns before connecting).
    expect(socketState.sockets.length).toBe(0);
  });
});
