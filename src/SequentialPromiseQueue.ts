export class SequentialPromiseQueue {
  private queue: {
    callback: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (e: any) => void;
  }[] = [];
  private isProcessingQueue: boolean = false; // Flag to check if queue processing is ongoing

  public async push<T>(callback: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ callback, resolve, reject });

      if (!this.isProcessingQueue) {
        this.processQueue();
      }
    });
  }

  private async processQueue() {
    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      const { callback, resolve, reject } = this.queue.shift()!;

      try {
        const result = await callback();
        resolve(result);
      } catch (e: any) {
        reject(e);
      }
    }

    this.isProcessingQueue = false;
  }
}
