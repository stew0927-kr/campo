// The instruction sent with the photo. The rules are the ones of the task (1.4): what to read, where to put the point,
// and the JSON shape to answer in. The building and floor go in only as context: the model must not invent rooms.

export interface PromptContext {
  buildingId: string;
  level: number;
}

const floorWord = (level: number): string => (level < 0 ? `지하 ${-level}층(B${-level})` : `${level}층(${level}F)`);

export function buildPrompt(ctx: PromptContext): string {
  return `당신은 대학 건물의 층별안내도(평면도) 사진을 읽어 길안내용 지점을 뽑는 도구입니다.
건물: ${ctx.buildingId}, 층: ${floorWord(ctx.level)}.

좌표 규칙:
- 좌표는 이 사진(이미지) 기준 0~1000 정규화 값입니다. 원점은 왼쪽 위, x는 오른쪽으로, y는 아래쪽으로 커집니다.
- 사진이 기울어져 있어도 사진 그대로의 좌표를 적으세요(회전은 서버가 맞춥니다).

읽을 것(node의 kind):
- "corridor": 복도의 중심선 위의 점들. 복도가 꺾이면 꺾이는 지점마다 점을 찍고, 복도 구간은 "corridors": [{"from": i, "to": j}](nodes 배열의 0부터 시작하는 인덱스)로 잇습니다. 복도의 갈림길에도 점을 찍습니다.
- "door": 교실·연구실·사무실 문의 위치(문이 복도와 닿는 자리). "room_ref"(예: "301"), "space_name"(예: "3학년 1반", "공학관 301호"), "door_role"("front" | "back" | "other"). 오른쪽·아래쪽 등에 있는 호실 안내표 텍스트를 반드시 읽어 번호와 이름을 채웁니다. 한 방에 문이 두 개면 앞문은 "front", 뒷문은 "back"으로 구분합니다.
- "stair_landing": 계단의 벽이 아니라 복도와 닿는 열린 입구의 중앙.
- "elevator_stop": 엘리베이터 문 앞 중앙. "elevator_id"(같은 엘리베이터는 같은 id, 예: "EV1").
- "restroom": 화장실 입구. "restroom_gender"("male" | "female" | "unisex" | "family").
- 읽을 수 없거나 확실하지 않은 항목은 점을 찍지 말고 "warnings"에 한국어 문장으로 남깁니다. 지어내지 마세요.

답은 아래 형식의 JSON 하나만 보내세요. 설명 문장, 마크다운, 코드펜스는 쓰지 않습니다.
{
  "nodes": [
    { "kind": "corridor", "x": 512, "y": 300 },
    { "kind": "door", "x": 480, "y": 260, "room_ref": "301", "space_name": "3학년 1반", "door_role": "front" },
    { "kind": "stair_landing", "x": 120, "y": 300 },
    { "kind": "elevator_stop", "x": 860, "y": 310, "elevator_id": "EV1" },
    { "kind": "restroom", "x": 700, "y": 340, "restroom_gender": "male" }
  ],
  "corridors": [ { "from": 0, "to": 3 } ],
  "warnings": ["우측 하단 안내표가 흐려 302호 이름을 읽지 못했습니다."]
}`;
}
