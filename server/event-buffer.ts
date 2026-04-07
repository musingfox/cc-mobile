/**
 * EventBuffer — in-memory ring buffer for WebSocket message replay on reconnect
 */

export interface BufferedEvent {
  eventId: number;
  sessionId: string;
  message: any;
  timestamp: number;
}

interface SessionBuffer {
  events: BufferedEvent[];
  nextId: number;
}

export class EventBuffer {
  private readonly maxSize: number;
  private readonly sessions: Map<string, SessionBuffer>;

  constructor(maxSize: number = 500) {
    this.maxSize = maxSize;
    this.sessions = new Map();
  }

  /**
   * Add event to buffer, returns assigned eventId (monotonic per session, starting at 1)
   */
  append(sessionId: string, message: any): number {
    let sessionBuffer = this.sessions.get(sessionId);

    if (!sessionBuffer) {
      sessionBuffer = {
        events: [],
        nextId: 1,
      };
      this.sessions.set(sessionId, sessionBuffer);
    }

    const eventId = sessionBuffer.nextId++;
    const event: BufferedEvent = {
      eventId,
      sessionId,
      message,
      timestamp: Date.now(),
    };

    sessionBuffer.events.push(event);

    // Buffer overflow: drop oldest event
    if (sessionBuffer.events.length > this.maxSize) {
      sessionBuffer.events.shift();
    }

    return eventId;
  }

  /**
   * Retrieve events after lastEventId (exclusive — returns eventId > afterEventId)
   */
  replay(sessionId: string, afterEventId: number): BufferedEvent[] {
    const sessionBuffer = this.sessions.get(sessionId);

    if (!sessionBuffer || sessionBuffer.events.length === 0) {
      return [];
    }

    return sessionBuffer.events.filter((event) => event.eventId > afterEventId);
  }

  /**
   * Get latest event ID for session
   */
  getLatestEventId(sessionId: string): number | null {
    const sessionBuffer = this.sessions.get(sessionId);

    if (!sessionBuffer || sessionBuffer.events.length === 0) {
      return null;
    }

    return sessionBuffer.events[sessionBuffer.events.length - 1].eventId;
  }

  /**
   * Clear session buffer
   */
  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Get buffer stats
   */
  getStats(sessionId: string): { count: number; oldest: number | null; newest: number | null } {
    const sessionBuffer = this.sessions.get(sessionId);

    if (!sessionBuffer || sessionBuffer.events.length === 0) {
      return { count: 0, oldest: null, newest: null };
    }

    return {
      count: sessionBuffer.events.length,
      oldest: sessionBuffer.events[0].eventId,
      newest: sessionBuffer.events[sessionBuffer.events.length - 1].eventId,
    };
  }
}
