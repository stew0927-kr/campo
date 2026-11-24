import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { Barometer } from 'expo-sensors';
import { sensorFix } from './sensorFix.ts';
import type { SensorFix } from '@campo/core';

/** Shown when the phone's location (GPS) is switched off: guidance keeps working from the map and the step cards. */
export const GPS_OFF_MESSAGE = '휴대폰의 위치(GPS)가 꺼져 있습니다. 위치를 켜면 현재 위치를 함께 보여 드립니다. 단계별 안내는 계속 이용할 수 있습니다.';
export const GPS_DENIED_MESSAGE = '위치 권한이 없어 현재 위치는 보여 드리지 못합니다. 단계별 안내는 계속 이용할 수 있습니다.';
export const GPS_FAILED_MESSAGE = '위치 센서를 시작하지 못했습니다. 단계별 안내는 지도와 문구로 계속 이용할 수 있습니다.';

/**
 * GPS (+ barometer) fixes while `enabled` (route guidance is on). Nothing runs otherwise: location is used on demand only.
 *
 * Guidance never stops because of the sensors. A missing permission, location switched off or a sensor error only leaves a
 * message; the step-by-step guidance keeps going without a position. (Before, any of these — and the app briefly going to
 * the background while Android shows the permission or location-accuracy dialog — called stop, so 위치 안내 시작 flipped to
 * 중지 and straight back.) Going to the background after the start pauses the subscriptions; coming back resumes them.
 */
export function useSensorFixes(enabled: boolean, pushFix: (fix: SensorFix) => unknown) {
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!enabled) { setRunning(false); setMessage(null); return; }
    let cancelled = false;
    /** A start is in progress: system dialogs it opens send the app to the background for a moment, which must not pause. */
    let starting = false;
    let paused = false;
    let positionSub: Location.LocationSubscription | null = null;
    let baroSub: { remove(): void } | null = null;
    let baseline: number | null = null, pressure: number | null = null, lastTime = -Infinity;
    const stopSubs = () => { positionSub?.remove(); positionSub = null; baroSub?.remove(); baroSub = null; };
    async function start() {
      if (starting || cancelled) return;
      starting = true;
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (permission.status !== 'granted') { setMessage(GPS_DENIED_MESSAGE); return; }
        let servicesOn = true;
        try { servicesOn = await Location.hasServicesEnabledAsync(); } catch { /* unknown: try to watch anyway */ }
        if (cancelled) return;
        if (!servicesOn) { setMessage(GPS_OFF_MESSAGE); return; }
        try {
          if (!baroSub && await Barometer.isAvailableAsync() && !cancelled) {
            baroSub = Barometer.addListener((sample) => { baseline ??= sample.pressure; pressure = sample.pressure; });
          }
        } catch { /* Barometer is optional: continue with GPS-only fixes. */ }
        if (cancelled) return;
        const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }, (position) => {
          if (cancelled || paused || position.timestamp <= lastTime) return;
          lastTime = position.timestamp;
          pushFix(sensorFix(position, baseline, pressure));
        });
        if (cancelled || paused) { sub.remove(); return; }
        positionSub = sub;
        setMessage(null);
        setRunning(true);
      } catch {
        if (!cancelled) { stopSubs(); setMessage(GPS_FAILED_MESSAGE); setRunning(false); }
      } finally { starting = false; }
    }
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (paused) { paused = false; void start(); }
        return;
      }
      if (state === 'background' && !starting && positionSub) { paused = true; stopSubs(); setRunning(false); }
    });
    setMessage(null);
    void start();
    return () => { cancelled = true; stopSubs(); appSub.remove(); setRunning(false); };
  }, [enabled, pushFix]);
  return { running, message };
}
