// One native subscription per sensor, however many parts of the screen read it. The native listener is added with the
// first reader and removed with the last, so nothing keeps the sensor (and the battery) running after the readers are gone.

export interface SensorLike<T> {
  addListener(listener: (reading: T) => void): { remove(): void };
  setUpdateInterval(intervalMs: number): void;
}

export interface SharedSensor<T> {
  /** Start receiving readings. The returned function stops them; calling it twice is harmless. */
  subscribe(listener: (reading: T) => void): () => void;
  /** The newest reading while someone is subscribed; undefined before the first one and after the last reader left. */
  latest(): T | undefined;
  /** How many readers there are (for tests and leak checks). */
  readers(): number;
}

export function sharedSensor<T>(sensor: SensorLike<T>, intervalMs: number): SharedSensor<T> {
  const listeners = new Set<(reading: T) => void>();
  let native: { remove(): void } | null = null;
  let last: T | undefined;

  return {
    subscribe(listener) {
      // A wrapper per call, so the same function subscribed twice counts as two readers.
      const mine = (reading: T): void => listener(reading);
      listeners.add(mine);
      if (!native) {
        sensor.setUpdateInterval(intervalMs);
        native = sensor.addListener((reading) => {
          last = reading;
          for (const l of [...listeners]) l(reading);
        });
      }
      return () => {
        if (!listeners.delete(mine)) return;
        if (listeners.size === 0 && native) {
          native.remove();
          native = null;
          last = undefined; // a stale pressure must not be read as the current one later
        }
      };
    },
    latest: () => last,
    readers: () => listeners.size,
  };
}
