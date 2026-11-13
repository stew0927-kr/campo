# 캠포 현장 조사 앱 명세 (apps/mobile)

현장을 걸으며 한 손으로 지점·문·계단·출입구를 기록하고, 사진·기압·방향을 함께 남긴 뒤 PC 편집기에서 한 번에 불러오는 앱이다. 사용자용 길안내 앱이 아니다(SPEC-v0.2 9장의 "앱 화면"은 여전히 범위 밖).

## 1. 원칙

- **지도 원본 스키마(`campo.schema.json`)는 바꾸지 않는다.** 사진 경로와 센서값은 현장 기록 파일에만 둔다.
- **앱도 `packages/core/src/edit`의 동작만으로 데이터를 바꾼다.** 편집기와 같은 엔진, 같은 불변식, 같은 되돌리기다.
- **위치는 앱 지도에서 사람이 직접 찍는다.** 화면 가운데 십자선 아래가 기록 위치다. 실내에서는 GPS를 쓰지 않는다.
- **앱 지도는 캠포 데이터(건물 외곽선, 지점, 구간)만 그린다.** 배경 타일이 없어서 통신 없이 동작하고, 구글·네이버·카카오 지도는 들어가지 않는다.
- 길찾기 규칙은 그대로다. 앱이 만드는 계단·엘리베이터·출입구 연결도 구간으로만 이어지고 층 번호를 비교하지 않는다.
- 현장에서 만든 Feature의 `source`는 `field-survey-{yyyy-mm}`이다(SPEC.md 4.1).

## 2. 기록 버튼

| 버튼 | 만드는 것 |
|---|---|
| 출발점 지정 | 십자선 근처의 기존 지점을 출발점으로 삼거나, 없으면 새 지점 |
| 갈림길 기록 | 지점 하나 + 직전 지점과 잇는 구간(바깥이면 `footway`, 건물 안이면 `corridor`) |
| 문/강의실 번호 | `door` 지점(`room_ref`) + 가까운 복도에 연결(`attachDoor`) |
| 계단/EV 층 변경 | 양쪽 층의 `stair_landing` 또는 `elevator_stop` + `steps` / `elevator` 구간. 출발과 도착에서 기압을 재어 높이를 남긴다 |
| 포탈 | `entrance` 지점 + 바깥 지점과 잇는 `edge_type: portal` 구간 |

문, 계단, 출입구를 기록할 때 [사진 촬영]으로 바로 찍을 수 있다. 터치 대상은 모두 48dp 이상이다.

## 3. 센서

- **기압계**: 층 이동의 시작과 끝 기압 차이를 국제 기압고도식으로 높이(m)로 바꾼다(`heightFromPressure`). 짧은 시간의 차이만 쓰므로 날씨에 따른 절대 기압은 상쇄된다. 구간의 평면 길이가 0보다 크면 경사도(%)도 함께 남긴다.
- **나침반**: 자력계 x, y로 자북 기준 방향각(0~360°)을 구한다(`headingFromMagnetometer`). 휴대폰을 눕혀 들었을 때만 맞다.
- 측정값은 **현장 기록의 측정값으로만** 남긴다. 지도 원본의 `ext.floor_height_m`이나 길찾기 시간에 자동으로 넣지 않는다(SPEC-v0.2 9장: 경사도 계산·고도 합치기는 하지 않음).

## 4. 현장 기록 파일

`data/schema/survey.schema.json`이 모양을 검사한다. 타입과 함수는 `packages/core/src/survey/`.

```json
{
  "format": "campo-survey",
  "version": 1,
  "id": "sv-20261114-eng1-3f",
  "campus": "hanyang-seoul",
  "surveyed_at": "2026-11-14T10:00:00+09:00",
  "changeset": { "id": "cs-20261114-eng1-3f", "source": "editor", "…": "SPEC-v0.2 7.1과 같은 changeset" },
  "attachments": {
    "n_ENG1_3_door_k7x2qa": { "recorded_at": "…", "photos": ["photos/n_ENG1_3_door_k7x2qa-1.jpg"], "heading_mag_deg": 87.5, "pressure_hpa": 1012.3 }
  },
  "vertical": [
    { "edge_id": "e_ENG1_3_k2m9xa", "pressure_start_hpa": 1012.3, "pressure_end_hpa": 1011.8, "height_m": 4.2, "method": "barometer", "measured_at": "…" }
  ]
}
```

- `changeset`: 앱에 실어 둔 캠퍼스 데이터(기준 상태)와 조사 뒤 상태의 차이다. 기존 changeset과 형식이 같아서 충돌 검사(`rev_mismatch` 등)와 `applyChangeset`을 그대로 쓴다. 지도를 바꾸지 않고 사진만 붙였으면 없다.
- `attachments`: Feature id별 사진·방향·기압. 사진 경로는 기록 폴더 안의 `photos/…`만 허용한다.
- `vertical`: 구간별 기압 측정. `height_m`은 구간의 `from`에서 `to`로 올라간 높이이고 내려가면 음수다.
- 누가, 어느 기기로, 어떤 경로로 걸었는지는 필드가 없다. 스키마가 모르는 필드를 모든 단계에서 막는다.
- 되돌린 Feature의 첨부와 측정은 내보낼 때 빠진다(`buildSurvey`).

## 5. 저장과 내보내기

- 앱은 동작 하나마다 기기 안에 현재 상태를 저장한다(임시 파일에 쓴 뒤 바꿔치기). 앱이 꺼져도 이어서 조사한다.
- [데이터 내보내기]는 `survey.json`과 `photos/`를 zip 하나로 묶어 공유한다.
- PC 편집기의 "현장 기록 불러오기"가 zip을 읽어 스키마 검사 → 충돌 검사 → `applyChangeset` 한 번(되돌리기 한 번)으로 넣고, 파일은 `data/surveys/{id}/`에 둔다. `survey.json`은 커밋하고 `photos/`는 커밋하지 않는다(용량, 사람 얼굴).
