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
});
