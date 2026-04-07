export interface HeartbeatOptions {
  intervalMs?: number; // default 30000
  timeoutMs?: number; // default 10000
}

export interface HeartbeatSender {
  send(data: any): void;
  close(): void;
}

export class HeartbeatManager {
  private sender: HeartbeatSender;
  private intervalMs: number;
  private timeoutMs: number;
  private intervalTimer: Timer | null = null;
  private timeoutTimer: Timer | null = null;
  private alive = true;

  constructor(sender: HeartbeatSender, options?: HeartbeatOptions) {
    this.sender = sender;
    this.intervalMs = options?.intervalMs ?? 30000;
    this.timeoutMs = options?.timeoutMs ?? 15000;
  }

  start(): void {
    // Idempotent: if already started, do nothing
    if (this.intervalTimer !== null) {
      return;
    }

    this.alive = true;
    // Don't send ping immediately — let client settle after connect
    this.intervalTimer = setInterval(() => {
      this.sendPing();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  recordPong(): void {
    this.alive = true;
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  isAlive(): boolean {
    return this.alive;
  }

  private sendPing(): void {
    this.sender.send({ type: "ping", timestamp: Date.now() });

    // Start timeout timer
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
    }
    this.timeoutTimer = setTimeout(() => {
      this.alive = false;
      this.sender.close();
      this.stop();
    }, this.timeoutMs);
  }
}
