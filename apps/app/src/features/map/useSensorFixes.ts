import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { Barometer } from 'expo-sensors';
import { sensorFix } from './sensorFix.ts';
import type { SensorFix } from '@campo/core';

export function useSensorFixes(enabled: boolean, pushFix: (fix: SensorFix) => unknown, onStop: () => void) {
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!enabled) { setRunning(false); return; }
    let cancelled = false;
    let positionSub: Location.LocationSubscription | null = null;
    let baroSub: { remove(): void } | null = null;
    let baseline: number | null = null, pressure: number | null = null, lastTime = -Infinity;
    function stop() { cancelled = true; positionSub?.remove(); baroSub?.remove(); setRunning(false); }
    const appSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { stop(); onStop(); setMessage('앱이 백그라운드로 이동해 위치 추적을 멈췄습니다. 다시 시작해 주세요.'); }
    });
    setMessage(null);
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (permission.status !== 'granted') { setMessage('위치 권한이 없습니다. 수동 길찾기는 계속 이용할 수 있습니다.'); onStop(); return; }
        try {
          if (await Barometer.isAvailableAsync() && !cancelled) {
            baroSub = Barometer.addListener((sample) => { baseline ??= sample.pressure; pressure = sample.pressure; });
          }
        } catch { /* Barometer is optional: continue with GPS-only fixes. */ }
        if (cancelled) return;
        positionSub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }, (position) => {
          if (cancelled || position.timestamp <= lastTime) return;
          lastTime = position.timestamp;
          pushFix(sensorFix(position, baseline, pressure));
        });
        if (cancelled) positionSub.remove(); else setRunning(true);
      } catch { if (!cancelled) { positionSub?.remove(); baroSub?.remove(); setMessage('위치 센서를 시작하지 못했습니다. 수동으로 출발지를 선택해 주세요.'); setRunning(false); onStop(); } }
    })();
    return () => { stop(); appSub.remove(); };
  }, [enabled, pushFix, onStop]);
  return { running, message };
}
