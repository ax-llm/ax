type CacheValue<T> = {
  value: T;
  expiry: Date;
};

export class Cache<T> {
  private store: Map<string, CacheValue<T>> = new Map();

  set(key: string, value: Readonly<T>, maxAgeSeconds: number) {
    const expiry = new Date(Date.now() + maxAgeSeconds * 1000);

    this.store.set(key, { value, expiry });

    setTimeout(() => this.removeIfExpired(key), maxAgeSeconds * 1000);
  }

  get(key: string): T | undefined {
    const cacheValue = this.store.get(key);

    if (cacheValue) {
      cacheValue.expiry = new Date(Date.now() + 30 * 1000); // Reset expiry
    }

    return cacheValue?.value;
  }

  removeIfExpired(key: string) {
    const cacheValue = this.store.get(key);

    if (!cacheValue) {
      return;
    }

    if (cacheValue && cacheValue.expiry.getTime() <= Date.now()) {
      this.store.delete(key);
    } else {
      const remainingTime = cacheValue.expiry.getTime() - Date.now();
      setTimeout(() => this.removeIfExpired(key), remainingTime);
    }
  }
}
