// The phone's barometer and compass as React hooks. Each hook reads through one shared native subscription, stops
// reading while the app is in the background, and removes everything it added when the screen goes away.
import { circularMeanDeg, headingFromMagnetometer } from '@campo/core';
import { Barometer, Magnetometer } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { sharedSensor, type SharedSensor } from './shared.ts';

const barometer = sharedSensor(Barometer, 500);
const magnetometer = sharedSensor(Magnetometer, 250);

/** Headings averaged over this many readings (about a second) so the number does not flicker. */
const HEADING_WINDOW = 5;

export interface SensorValue<V> {
  /** null while it is being checked, false when the phone has no such sensor (or reading it was refused). */
  available: boolean | null;
  /** The newest value while the app is in front; undefined before the first reading. */
  value: V | undefined;
}

interface Source<T> {
  shared: SharedSensor<T>;
  /** Resolves to whether the sensor exists and may be read. */
  ready(): Promise<boolean>;
}

function useSensor<T, V>(source: Source<T>, map: (reading: T) => V | undefined): SensorValue<V> {
  const [available, setAvailable] = useState<boolean | null>(null);
  const mapRef = useRef(map);
  mapRef.current = map;
  // When another part of the screen is already reading the sensor, start from its newest reading instead of waiting for the next one.
  const [value, setValue] = useState<V | undefined>(() => {
    const newest = source.shared.latest();
    return newest !== undefined ? map(newest) : undefined;
  });

  useEffect(() => {
    let alive = true;
    let stop: (() => void) | null = null;

    const start = (): void => {
      if (!alive || stop) return;
      stop = source.shared.subscribe((reading) => {
        const next = mapRef.current(reading);
        if (next !== undefined) setValue(next);
      });
    };
    const pause = (): void => {
      stop?.();
      stop = null;
      setValue(undefined); // what was read before the pause is not the current value any more
    };

    /** The check's answer, once it is in. Reading only ever starts after a yes. */
    let usable = false;
    const settle = (ok: boolean): void => {
      if (!alive) return; // unmounted while the check was running: subscribe nothing
      usable = ok;
      setAvailable(ok);
      if (ok && AppState.currentState === 'active') start();
    };
    source.ready().then(settle, () => settle(false));
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') pause();
      else if (usable) start();
    });

    return () => {
      alive = false;
      appState.remove();
      stop?.();
      stop = null;
    };
    // `source` is a module constant; the effect runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { available, value };
}

const barometerSource: Source<{ pressure: number }> = {
  shared: barometer,
  // iOS asks for the motion permission; Android has none for the barometer and answers granted.
  ready: async () => (await Barometer.isAvailableAsync()) && (await Barometer.requestPermissionsAsync()).granted,
};

const magnetometerSource: Source<{ x: number; y: number }> = {
  shared: magnetometer,
  ready: () => Magnetometer.isAvailableAsync(),
};

/** Air pressure in hPa. */
export function usePressure(): SensorValue<number> {
  return useSensor(barometerSource, (r) => (Number.isFinite(r.pressure) && r.pressure > 0 ? r.pressure : undefined));
}

/** Where the phone's top edge points, degrees clockwise from magnetic north (phone held flat), smoothed. */
export function useHeading(): SensorValue<number> {
  const recent = useRef<number[]>([]);
  return useSensor(magnetometerSource, (r) => {
    const heading = headingFromMagnetometer(r.x, r.y);
    if (heading === undefined) return undefined;
    recent.current = [...recent.current.slice(-(HEADING_WINDOW - 1)), heading];
    return circularMeanDeg(recent.current);
  });
}
