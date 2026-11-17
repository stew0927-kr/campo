// The phone's barometer and compass as React hooks. Each hook reads through one shared native subscription, stops
// reading while the app is in the background, and removes everything it added when the screen goes away.
//
// The compass comes from the operating system's heading (expo-location watchHeadingAsync: Android's rotation-vector
// sensor and iOS Core Location both fuse the magnetometer with the accelerometer and gyroscope), so it stays right when
// the phone is tilted and turns smoothly through north. Only the heading is read: no position is ever requested from
// it. Where the system heading cannot be had (permission refused, no such service) the raw magnetometer is the fallback,
// which is only right with the phone held flat.
import { circularMeanDeg, headingFromMagnetometer, normalizeDeg } from '@campo/core';
import * as Location from 'expo-location';
import { Barometer, Magnetometer } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { smoothHeading } from './heading.ts';
import { sharedSensor, type SensorLike, type SharedSensor } from './shared.ts';

const barometer = sharedSensor(Barometer, 500);
const magnetometer = sharedSensor(Magnetometer, 250);

/** The system heading as a SensorLike: watchHeadingAsync is asynchronous, so a reader that leaves early is still cleaned up. */
const systemHeading: SensorLike<{ magHeading: number; accuracy: number }> = {
  setUpdateInterval: () => undefined, // the system decides; it is about 10–30 Hz
  addListener(listener) {
    let removed = false;
    let sub: { remove(): void } | null = null;
    Location.watchHeadingAsync((h) => listener({ magHeading: h.magHeading, accuracy: h.accuracy })).then(
      (s) => {
        if (removed) s.remove();
        else sub = s;
      },
      () => undefined,
    );
    return {
      remove() {
        removed = true;
        sub?.remove();
        sub = null;
      },
    };
  },
};
const heading = sharedSensor(systemHeading, 0);

/** Raw magnetometer headings averaged over this many readings (about a second) so the number does not flicker. */
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

function useSensor<T, V>(source: Source<T> | null, map: (reading: T) => V | undefined): SensorValue<V> {
  const [available, setAvailable] = useState<boolean | null>(null);
  const mapRef = useRef(map);
  mapRef.current = map;
  // When another part of the screen is already reading the sensor, start from its newest reading instead of waiting for the next one.
  const [value, setValue] = useState<V | undefined>(() => {
    const newest = source?.shared.latest();
    return newest !== undefined ? map(newest) : undefined;
  });

  useEffect(() => {
    if (!source) return undefined;
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
  }, [source]);

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

/** Whether the system heading may be read: both platforms tie it to the foreground location permission. Asked once. */
let systemReady: Promise<boolean> | null = null;
const headingSource: Source<{ magHeading: number; accuracy: number }> = {
  shared: heading,
  ready: () => {
    systemReady ??= (async () => {
      const now = await Location.getForegroundPermissionsAsync();
      const granted = now.granted || (now.canAskAgain && (await Location.requestForegroundPermissionsAsync()).granted);
      if (!granted) return false;
      // A first reading proves the service works on this phone (some have no fused heading).
      const first = await Promise.race([Location.getHeadingAsync().then(() => true, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), 4000))]);
      return first;
    })().catch(() => false);
    return systemReady;
  },
};

/** Air pressure in hPa. */
export function usePressure(): SensorValue<number> {
  return useSensor(barometerSource, (r) => (Number.isFinite(r.pressure) && r.pressure > 0 ? r.pressure : undefined));
}

/**
 * Where the phone's top edge points, degrees clockwise from magnetic north, smoothed. The system's tilt-compensated
 * heading when it is available, else the flat-held magnetometer.
 */
export function useHeading(): SensorValue<number> & { tiltCompensated: boolean } {
  const smoothed = useRef<number | undefined>(undefined);
  const system = useSensor(headingSource, (r) => {
    if (!Number.isFinite(r.magHeading) || r.magHeading < 0) return undefined;
    smoothed.current = smoothHeading(smoothed.current, normalizeDeg(r.magHeading));
    return smoothed.current;
  });
  const recent = useRef<number[]>([]);
  // The magnetometer is only read once the system heading is known not to work.
  const raw = useSensor(system.available === false ? magnetometerSource : null, (r) => {
    const h = headingFromMagnetometer(r.x, r.y);
    if (h === undefined) return undefined;
    recent.current = [...recent.current.slice(-(HEADING_WINDOW - 1)), h];
    return circularMeanDeg(recent.current);
  });
  if (system.available !== false) return { ...system, tiltCompensated: true };
  return { ...raw, tiltCompensated: false };
}
