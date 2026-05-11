import type { Envelope } from '@embed-sdk/protocol';

/**
 * Priority levels for queued messages.
 * Lower number = higher priority. Sorted ascending (0 is highest).
 *
 * CRITICAL: handshake, auth — must reach widget, never drop.
 * HIGH:     open, close, identify — important but tolerable to drop on reconnect.
 * NORMAL:   general widget commands (default).
 * LOW:      analytics, telemetry — best-effort.
 */
export const Priority = {
  CRITICAL: 0,
  HIGH:     1,
  NORMAL:   2,
  LOW:      3,
} as const;

export type Priority = (typeof Priority)[keyof typeof Priority];

interface QueueItem {
  envelope: Envelope;
  priority: Priority;
  enqueuedAt: number;
  /** 0 means no expiry. */
  expiresAt: number;
}

/**
 * Priority-sorted message queue with per-item TTL.
 *
 * Used to hold messages sent before the iframe is READY and to
 * replay HIGH+CRITICAL messages after a reconnect.
 */
export class MessageQueue {
  private _items: QueueItem[] = [];

  enqueue(
    envelope: Envelope,
    priority: Priority = Priority.NORMAL,
    ttlMs = 0
  ): void {
    const now = Date.now();
    this._items.push({
      envelope,
      priority,
      enqueuedAt: now,
      expiresAt: ttlMs > 0 ? now + ttlMs : 0,
    });
    // Stable sort: priority ASC → enqueue time ASC (FIFO within same priority)
    this._items.sort((a, b) =>
      a.priority !== b.priority
        ? a.priority - b.priority
        : a.enqueuedAt - b.enqueuedAt
    );
  }

  /**
   * Drain all non-expired messages with priority ≤ maxPriority.
   * Expired messages are silently discarded regardless of priority.
   */
  flush(maxPriority: Priority = Priority.LOW): Envelope[] {
    const now     = Date.now();
    const flushed: Envelope[]  = [];
    const keep:    QueueItem[]  = [];

    for (const item of this._items) {
      const expired = item.expiresAt > 0 && item.expiresAt < now;
      if (expired) continue;
      if (item.priority <= maxPriority) {
        flushed.push(item.envelope);
      } else {
        keep.push(item);
      }
    }

    this._items = keep;
    return flushed;
  }

  /**
   * Drop NORMAL and LOW messages, keep CRITICAL + HIGH.
   * Called before a reconnect so important commands survive the cycle.
   */
  trim(): void {
    this._items = this._items.filter(i => i.priority <= Priority.HIGH);
  }

  clear(): void { this._items = []; }

  get size(): number { return this._items.length; }
}
