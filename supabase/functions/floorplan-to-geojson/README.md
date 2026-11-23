# 안내도 자동 매핑 (`supabase/functions/floorplan-to-geojson`)

층별안내도 사진 한 장을 받아 비전 모델(Gemini 또는 Claude)로 복도·문·계단·엘리베이터·화장실을 읽고,
그 층 건물 외곽선에 맞춘 **GeoJSON 초안**(스키마 0.2의 node/edge Feature)을 돌려준다.
현장 조사 앱(`apps/mobile`)의 메뉴 [안내도 자동 매핑]이 부르고, 앱이 초안을 코어 동작 하나(되돌리기 한 번)로 지도에 넣는다.
모든 Feature는 `source: "school-floorplan-ai"`, `rev: 1`, `needs_check: true`다. 현장에서 확인해야 하는 초안이다.

| 파일 | 하는 일 |
|---|---|
| `index.ts` | `Deno.serve`. Deno 전역을 쓰는 유일한 파일 |
| `src/handler.ts` | 요청 검사 → 제공자 호출 → 해석 → 조립 → 응답, CORS, 오류 코드 |
| `src/prompt.ts` | 모델에 보낼 지시문 |
| `src/parse.ts` | 모델 답(코드펜스 포함 가능) → 검사한 초안. 좌표 0~1000 클램프·반올림, 모르는 종류와 범위 밖 복도 구간은 버리고 `warnings`에 개수 |
| `src/geometry.ts` | 회전(0/90/180/270, 시계방향) → 건물 bbox에 비율 유지·가운데 맞춤 → 위경도(소수 7자리) |
| `src/assemble.ts` | 초안 → FeatureCollection + `summary`. 문·계단·엘리베이터·화장실은 가장 가까운 복도 점(정규화 거리 120 이하)에 잇는다. 복도 구간 목록이 없으면 복도 점을 최근접 체인(200 이하)으로 잇는다 |
| `src/providers/gemini.ts`, `src/providers/anthropic.ts` | REST API를 `fetch`로 직접 부른다(SDK 없음). 모델의 텍스트만 돌려준다 |

`src/*.ts`는 Deno와 Node 어디서나 돌아가는 순수 모듈이다. 테스트는 앱 쪽 `apps/mobile/test/floorplanGeometry.test.ts`,
`floorplanFunction.test.ts`가 상대 경로로 그대로 불러 루트 `npm test`에서 돈다.

## 환경변수(서버)

| 이름 | 필수 | 설명 |
|---|---|---|
| `GEMINI_API_KEY` | 둘 중 하나(권장) | 있으면 Gemini를 먼저 쓴다 |
| `GEMINI_MODEL` | 선택 | 기본 `gemini-2.5-flash` |
| `ANTHROPIC_API_KEY` | 둘 중 하나 | Gemini 키가 없을 때 쓴다 |
| `ANTHROPIC_MODEL` | 선택 | 기본값은 `src/providers/anthropic.ts`의 `ANTHROPIC_DEFAULT_MODEL`. **모델 id는 이 환경변수로 바꿀 수 있다** |

둘 다 없으면 바로 `no_api_key`(500)를 돌려준다. 키는 코드나 저장소에 넣지 않고 Supabase secrets로만 넣는다.

```bash
supabase secrets set GEMINI_API_KEY=...
```

## 배포

```bash
supabase functions deploy floorplan-to-geojson
```

- JWT 검증을 켜 둔 채(기본) 배포하면 앱이 `EXPO_PUBLIC_SUPABASE_ANON_KEY`를 `Authorization: Bearer <anon key>`로 보낸다. 키가 없거나 틀리면 앱이 "anon 키 설정을 확인해 주세요"라고 알려 준다.
- 검증을 끄려면 `supabase functions deploy floorplan-to-geojson --no-verify-jwt`. 그러면 주소를 아는 누구나 부를 수 있으니(모델 비용) 시험할 때만 권한다.

## 앱 설정(`apps/mobile/.env.local`, 커밋하지 않음)

```
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co        # 주소는 이것 + /functions/v1/floorplan-to-geojson
EXPO_PUBLIC_FLOORPLAN_URL=https://…/floorplan-to-geojson  # 선택: 있으면 이 주소를 그대로 쓴다
EXPO_PUBLIC_SUPABASE_ANON_KEY=...                         # 선택: JWT 검증을 켰으면 필요
```

둘 다 없으면 앱의 [매핑 시작] 단추가 꺼지고 설정 안내 문장이 뜬다.

## 요청

```jsonc
POST /functions/v1/floorplan-to-geojson
{
  "imageBase64": "…",              // 필수. data:…;base64, 머리는 있어도 떼어 낸다
  "mimeType": "image/jpeg",        // 필수. image/jpeg | image/png | image/webp | image/gif
  "buildingId": "bldg_eng1",       // 필수
  "level": 3,                       // 필수. 1F = 1, B1 = -1, 0 금지
  "buildingPolygon": [[127.0,37.5], …], // 필수. 외곽 링(lng, lat) 4점 이상
  "rotationDeg": 90,               // 선택. 0 | 90 | 180 | 270, 기본 0
  "imageWidth": 1600, "imageHeight": 1200 // 선택. 보낸 사진의 픽셀 크기(가로·세로 비율을 지켜 맞춘다)
}
```

`rotationDeg`는 **사진을 시계방향으로 이만큼 돌려야 평면도가 바로 선다**는 뜻이다. 앱은 사진을 그대로 보내고
서버가 좌표만 돌린다(이미지 픽셀은 돌리지 않는다). 이미지 좌표(y 아래) 기준으로 90°는 `(x, y) → (1000 − y, x)`이다.
`imageWidth`/`imageHeight`가 없으면 0~1000 프레임을 정사각형으로 보고 맞춘다.

### 사진 크기 주의

앱은 사진을 **긴 변 1600px 이하, JPEG 품질 0.65**로 줄여 보낸다(보통 300~600KB, base64로 약 1.33배).
더 큰 사진을 그대로 보내면 업로드가 느리고 Edge Function 요청 본문 한도에 걸릴 수 있다. 직접 부를 때도 같은 크기를 권한다.

## 호출 예시

```bash
IMG=$(base64 -w0 sample-floorplan.jpg)
curl -sS -X POST "https://xxxx.supabase.co/functions/v1/floorplan-to-geojson" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"imageBase64\":\"$IMG\",\"mimeType\":\"image/jpeg\",\"buildingId\":\"bldg_eng1\",\"level\":3,\"rotationDeg\":0,
       \"buildingPolygon\":[[127.0440,37.5550],[127.0450,37.5550],[127.0450,37.5556],[127.0440,37.5556],[127.0440,37.5550]]}"
```

### 응답 예시(200)

```jsonc
{
  "ok": true,
  "geojson": { "type": "FeatureCollection", "features": [
    { "type": "Feature", "id": "fp-n-1", "geometry": { "type": "Point", "coordinates": [127.0443122, 37.5553011] },
      "properties": { "kind": "node", "source": "school-floorplan-ai", "rev": 1, "needs_check": true,
        "node_type": "corridor", "building_id": "bldg_eng1", "level": 3 } },
    { "type": "Feature", "id": "fp-n-4", "geometry": { "type": "Point", "coordinates": [127.0444511, 37.5553620] },
      "properties": { "kind": "node", "source": "school-floorplan-ai", "rev": 1, "needs_check": true,
        "node_type": "door", "building_id": "bldg_eng1", "level": 3,
        "name": "3학년 1반", "room_ref": "301", "space_name": "3학년 1반", "door_role": "front" } },
    { "type": "Feature", "id": "fp-e-1", "geometry": { "type": "LineString", "coordinates": [[127.0443122, 37.5553011], [127.0446020, 37.5553011]] },
      "properties": { "kind": "edge", "source": "school-floorplan-ai", "rev": 1, "needs_check": true,
        "highway": "corridor", "edge_type": "indoor", "from": "fp-n-1", "to": "fp-n-2",
        "bidirectional": true, "step_free": null, "level_from": 3, "level_to": 3,
        "building_from": "bldg_eng1", "building_to": "bldg_eng1" } }
  ] },
  "summary": { "nodeCount": 18, "edgeCount": 17, "doors": 12, "restrooms": 2, "stairs": 1, "elevators": 1, "skippedEdges": 0,
               "warnings": ["우측 하단 안내표가 흐려 302호 이름을 읽지 못했습니다."] },
  "buildingId": "bldg_eng1", "level": 3, "rotationDeg": 0, "provider": "gemini"
}
```

Feature id(`fp-n-*`, `fp-e-*`)는 이 응답 안에서만 쓰는 임시 id다. 앱이 넣을 때 코어 규칙(`n_{건물}_{층}_{종류}_xxxxxx`)으로 새로 붙이고,
`building_id`/`level`도 앱이 지금 서 있는 층 값으로 덮어쓴다. 같은 층·같은 종류의 기존 지점이 2m 안에 있으면 새로 만들지 않는다.
엘리베이터의 `elevator_id`(예: `EV1`)는 앱이 그 건물의 승강로 id(`{코드}_elevA` 등)로 바꾼다.

## 오류

| HTTP | `code` | 언제 |
|---|---|---|
| 400 | `bad_request` | JSON이 아님, 필수 칸 없음, `level` 0, `rotationDeg`가 네 값 밖, 외곽 링 점 4개 미만 |
| 422 | `extract_failed` | 모델 답에서 JSON을 못 읽음, 또는 지점을 하나도 못 읽음 |
| 500 | `no_api_key` | `GEMINI_API_KEY`·`ANTHROPIC_API_KEY` 모두 없음 |
| 500 | `provider_error` | 모델 API가 오류를 돌려주거나 응답하지 않음 |

실패 본문은 `{ "ok": false, "code": "…", "error": "사람이 읽을 한국어 문장" }`이고, 앱은 `error` 문장을 그대로 보여 준다.
`OPTIONS`는 CORS 프리플라이트로 204. 모든 응답에 `Access-Control-Allow-Origin: *`,
`Access-Control-Allow-Headers: authorization, content-type`, `Access-Control-Allow-Methods: POST, OPTIONS`가 붙는다.

## 한계

- 좌표는 건물 외곽선의 bbox에 사진을 통째로 맞춘 근사다. 안내도에 여백이나 범례가 넓으면 한쪽으로 쏠린다. 반영 뒤 편집기에서 옮겨 맞춘다.
- 엘리베이터·계단의 다른 층 연결(층 사이 구간)은 만들지 않는다. 앱에서 지점을 누르고 [다른 층과 연결]로 잇는다.
