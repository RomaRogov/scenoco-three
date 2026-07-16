import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBridgeCore, type BridgeSocket } from '../../packages/editor/src/server.js';
import type { EditorResponse } from '../../packages/editor/src/protocol.js';

const OPEN = 1;
const CLOSED = 3;

/** A fake editor socket that records sends and lets a test drive replies/close. */
function fakeSocket() {
  const handlers: { message?: (d: unknown) => void; close?: () => void } = {};
  const sent: string[] = [];
  const sock = {
    readyState: OPEN,
    OPEN,
    send: (d: string) => sent.push(d),
    on: (ev: 'message' | 'close', cb: (d: unknown) => void) => {
      handlers[ev] = cb as never;
    },
  };
  return {
    sock: sock as unknown as BridgeSocket,
    sent,
    reply: (r: EditorResponse) => handlers.message?.(JSON.stringify(r)),
    close: () => {
      sock.readyState = CLOSED;
      handlers.close?.();
    },
    lastCmdId: () => (JSON.parse(sent[sent.length - 1]!) as { id: string }).id,
  };
}

describe('bridge core — multi-editor routing + failover', () => {
  it('routes a command to the newest editor and fails a lost connection over to another open one', async () => {
    const { bridge, register } = createBridgeCore();
    const a = fakeSocket();
    const b = fakeSocket();
    register(a.sock);
    register(b.sock);

    const p = bridge.send({ id: 'c1', type: 'run' });
    expect(b.sent).toHaveLength(1); // newest connection is the control target
    expect(a.sent).toHaveLength(0);

    b.close(); // the tab it was routed to closes mid-command → fail over to `a`
    expect(a.sent).toHaveLength(1);
    expect(a.lastCmdId()).toBe('c1');

    a.reply({ id: 'c1', ok: true, result: { kind: 'ok', info: 'playing' } });
    await expect(p).resolves.toMatchObject({ ok: true });
  });

  it('rejects an in-flight command when its editor disconnects and none remain', async () => {
    const { bridge, register } = createBridgeCore();
    const a = fakeSocket();
    register(a.sock);
    const p = bridge.send({ id: 'c1', type: 'stop' });
    expect(a.sent).toHaveLength(1);
    a.close();
    await expect(p).rejects.toThrow(/disconnected before responding/);
  });

  it('reports connection state and rejects a send when every editor is closed', async () => {
    const { bridge, register } = createBridgeCore();
    expect(bridge.connected()).toBe(false);
    const a = fakeSocket();
    register(a.sock);
    expect(bridge.connected()).toBe(true);
    a.close();
    expect(bridge.connected()).toBe(false);
    await expect(bridge.send({ id: 'x', type: 'run' })).rejects.toThrow(/no editor connected/);
  });

  it('broadcasts pushes to every open editor, skipping closed ones', () => {
    const { bridge, register } = createBridgeCore();
    const a = fakeSocket();
    const b = fakeSocket();
    register(a.sock);
    register(b.sock);
    bridge.push({ push: 'shutdown' });
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    a.close();
    bridge.push({ push: 'shutdown' });
    expect(a.sent).toHaveLength(1); // closed → skipped
    expect(b.sent).toHaveLength(2);
  });
});

describe('bridge core — idle shutdown', () => {
  afterEach(() => vi.useRealTimers());

  it('halts when no editor ever connects within the initial grace', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    createBridgeCore({ onIdle, initialGraceMs: 1000, idleMs: 500 });
    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('halts after the last editor disconnects, but not while one stays connected', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const { register } = createBridgeCore({ onIdle, initialGraceMs: 1000, idleMs: 500 });
    const a = fakeSocket();
    register(a.sock); // cancels the initial-grace timer
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
    a.close(); // arms the idle timer
    vi.advanceTimersByTime(499);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('a reconnect within the idle window cancels the pending halt', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const { register } = createBridgeCore({ onIdle, initialGraceMs: 1000, idleMs: 500 });
    const a = fakeSocket();
    register(a.sock);
    a.close(); // arm idle (500ms)
    vi.advanceTimersByTime(300);
    register(fakeSocket().sock); // a new instance connects → cancels the halt
    vi.advanceTimersByTime(500);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
