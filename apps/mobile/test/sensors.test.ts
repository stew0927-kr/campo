// Sensor subscriptions must not outlive their readers (battery, and listeners piling up on re-renders).
import { describe, expect, it } from 'vitest';
import { sharedSensor, type SensorLike } from '../src/sensors/shared.ts';

function fakeSensor() {
  const active = new Set<(reading: number) => void>();
  const sensor: SensorLike<number> & { emit(v: number): void; active: Set<unknown>; added: number; interval: number } = {
    active,
    added: 0,
    interval: 0,
    addListener(listener) {
      sensor.added++;
      active.add(listener);
      return { remove: () => void active.delete(listener) };
    },
    setUpdateInterval(ms) {
      sensor.interval = ms;
    },
    emit(v) {
      for (const l of [...active]) l(v);
    },
  };
  return sensor;
}

describe('sharedSensor', () => {
  it('adds one native listener for any number of readers and removes it with the last one', () => {
    const native = fakeSensor();
    const shared = sharedSensor(native, 500);
    expect(native.active.size).toBe(0); // nothing runs before someone reads

    const a: number[] = [];
    const b: number[] = [];
    const stopA = shared.subscribe((v) => a.push(v));
    const stopB = shared.subscribe((v) => b.push(v));
    expect(native.added).toBe(1);
    expect(native.interval).toBe(500);
    native.emit(1012.3);
    expect([a, b]).toEqual([[1012.3], [1012.3]]);
    expect(shared.latest()).toBe(1012.3);

    stopA();
    expect(native.active.size).toBe(1);
    native.emit(1012.1);
    expect([a, b]).toEqual([[1012.3], [1012.3, 1012.1]]);

    stopB();
    expect(native.active.size).toBe(0);
    expect(shared.readers()).toBe(0);
    expect(shared.latest()).toBeUndefined(); // a stale reading is not kept
  });

  it('stopping twice is harmless, and the same function may read twice', () => {
    const native = fakeSensor();
    const shared = sharedSensor(native, 200);
    const seen: number[] = [];
    const listener = (v: number) => seen.push(v);
    const stop1 = shared.subscribe(listener);
    const stop2 = shared.subscribe(listener);
    expect(shared.readers()).toBe(2);
    stop1();
    stop1();
    expect(shared.readers()).toBe(1);
    expect(native.active.size).toBe(1);
    native.emit(5);
    expect(seen).toEqual([5]);
    stop2();
    expect(native.active.size).toBe(0);
  });

  it('starts again after everyone left, like a screen that mounts, unmounts and mounts', () => {
    const native = fakeSensor();
    const shared = sharedSensor(native, 200);
    for (let i = 0; i < 50; i++) shared.subscribe(() => {})();
    expect(native.added).toBe(50);
    expect(native.active.size).toBe(0);
  });

  it('a reader that stops itself while a reading is delivered does not break the others', () => {
    const native = fakeSensor();
    const shared = sharedSensor(native, 200);
    const seen: number[] = [];
    const stop: () => void = shared.subscribe(() => stop());
    shared.subscribe((v) => seen.push(v));
    native.emit(1);
    native.emit(2);
    expect(seen).toEqual([1, 2]);
    expect(shared.readers()).toBe(1);
  });
});
