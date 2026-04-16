export class LatestOnlyQueue<T> {
  private active = false;
  private pending: T | null = null;

  constructor(private readonly worker: (item: T) => Promise<void>) {}

  enqueue(item: T) {
    this.pending = item;
    if (!this.active) {
      void this.drain();
    }
  }

  clear() {
    this.pending = null;
  }

  private async drain() {
    this.active = true;
    while (this.pending !== null) {
      const nextItem = this.pending;
      this.pending = null;
      await this.worker(nextItem);
    }
    this.active = false;
  }
}
