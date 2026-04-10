// packages/telegram/src/ThrottledBatchProcessor.ts

export class ThrottledBatchProcessor<T> {
  private pending = new Set<T>();
  private lastRunTime = 0;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly processItems: (items: T[]) => Promise<void>,
    private readonly intervalMs: number = 250,
  ) {
  }

  add(item: T): void {
    this.pending.add(item);
    this.schedule();
  }

  async flush(): Promise<void> {
    await this.run();
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
  }

  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  private schedule(): void {
    if (this.timer !== null) return;
    const now = Date.now();
    const delay = Math.max(0, this.lastRunTime + this.intervalMs - now);
    this.timer = setTimeout(() => this.run(), delay);
  }

  private async run(): Promise<void> {
    if (this.isProcessing) return;

    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.isProcessing = true;

    try {
      const items = [...this.pending];
      this.pending.clear();
      await this.processItems(items);
      this.lastRunTime = Date.now();
    } finally {
      this.isProcessing = false;
      this.timer = null;
      if (this.pending.size > 0) {
        this.schedule();
      }
    }
  }
}
