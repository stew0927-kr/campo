// 사진 위 진행 방향 화살표. 확대 뷰어와 캠퍼스 로드뷰가 함께 쓴다.
// 모양과 글(turnGuide의 "앞으로 25m 직진" / "25m 직진 후 왼쪽")을 함께 전달한다(색만 쓰지 않는다).
// 대각선 화살표와 사진 속 둥근 표식은 그리지 않는다: 곧게 가면 곧은 화살표, 꺾으면 ㄱ자로 꺾인 화살표.
import { StyleSheet, Text, View } from 'react-native';
import type { PhotoArrow } from '../contracts.ts';
import { arrowShift, turnGuide, type TurnGuide } from './turnGuide.ts';

/**
 * 사진 위 화살표.
 * - 곧게(straight): 아래쪽에 위를 가리키는 곧은 화살표. 사진 정면에서 살짝(±15° 밖) 어긋나면 그 방향 쪽으로 가로 위치만 옮긴다.
 * - 꺾기(turn): 직진 막대 끝에서 왼쪽/오른쪽으로 꺾이는 ㄱ자 화살표.
 * - behind(사용자가 고른 뒤쪽 사진에서만 남는다): 가운데 U턴 표시.
 * `guide`가 없으면 화살표 각도만으로 정한다(직진 거리 없이).
 */
export function ArrowOverlay({ arrow, guide = null }: { arrow: PhotoArrow; guide?: TurnGuide | null }) {
  if (arrow.mode === 'behind') {
    return (
      <View style={styles.overlay} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <View style={styles.uturn}>
          <Text style={styles.uturnGlyph}>{arrow.rotateDeg >= 0 ? '↻' : '↺'}</Text>
          <Text style={styles.uturnLabel}>뒤로</Text>
        </View>
      </View>
    );
  }
  const g = guide ?? turnGuide(null, arrow.rotateDeg)!;
  const left = g.kind === 'turn' ? '50%' : `${arrowShift(arrow.rotateDeg, arrow.xRatio) * 100}%`;
  return (
    <View style={styles.overlay} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      <View style={[styles.floorArrow, { left }]}>
        {g.kind === 'turn' ? <TurnGlyph side={g.side!} /> : <StraightGlyph />}
        <Text style={styles.arrowLabel}>{g.label}</Text>
      </View>
    </View>
  );
}

/*
 * 화살표는 흰 채움 + 검은 테두리. 테두리는 같은 조각들을 OUT만큼 크게 검게 먼저 깔고, 그 위에 흰 조각을 모두 올려 만든다
 * (흰 조각끼리 겹친 안쪽에는 검은 선이 남지 않는다).
 */
const OUT = 3;
const BAR = 18;
const HEAD_W = 50; // 머리 밑변
const HEAD_L = 34; // 머리 길이
const GLYPH_W = 96;
const GLYPH_H = 104;

/** 위를 가리키는 곧은 화살표. */
function StraightGlyph() {
  const cx = GLYPH_W / 2;
  const shaft = { left: cx - BAR / 2, top: HEAD_L - 2, width: BAR, height: GLYPH_H - HEAD_L + 2 };
  return (
    <View style={styles.glyph}>
      <Piece {...shaft} outline rounded />
      <Up cx={cx} top={0} outline />
      <Piece {...shaft} rounded />
      <Up cx={cx} top={0} />
    </View>
  );
}

/** ㄱ자: 아래에서 올라온 직진 막대가 위에서 왼쪽(오른쪽이면 좌우 반전)으로 꺾여 머리로 끝난다. */
function TurnGlyph({ side }: { side: 'left' | 'right' }) {
  const shaftX = GLYPH_W - BAR - 10; // 막대는 오른쪽에, 머리는 왼쪽으로
  const armTop = 22;
  const shaft = { left: shaftX, top: armTop, width: BAR, height: GLYPH_H - armTop };
  const arm = { left: HEAD_L - 2, top: armTop, width: shaftX + BAR - (HEAD_L - 2), height: BAR };
  const headCy = armTop + BAR / 2;
  return (
    <View style={[styles.glyph, side === 'right' && styles.mirror]}>
      <Piece {...shaft} outline rounded />
      <Piece {...arm} outline rounded />
      <Left cy={headCy} outline />
      <Piece {...shaft} rounded />
      <Piece {...arm} rounded />
      <Left cy={headCy} />
    </View>
  );
}

function Piece({ left, top, width, height, outline = false, rounded = false }: { left: number; top: number; width: number; height: number; outline?: boolean; rounded?: boolean }) {
  const o = outline ? OUT : 0;
  return <View style={{ position: 'absolute', left: left - o, top: top - o, width: width + 2 * o, height: height + 2 * o, borderRadius: rounded ? 4 + o : o,
    backgroundColor: outline ? '#000000' : '#FFFFFF' }} />;
}
/** 위를 가리키는 머리(삼각형). */
function Up({ cx, top, outline = false }: { cx: number; top: number; outline?: boolean }) {
  const o = outline ? OUT * 1.6 : 0;
  const half = HEAD_W / 2 + o;
  return <View style={[styles.tri, { left: cx - half, top: top - o, borderLeftWidth: half, borderRightWidth: half, borderBottomWidth: HEAD_L + o * 1.4,
    borderBottomColor: outline ? '#000000' : '#FFFFFF' }]} />;
}
/** 왼쪽을 가리키는 머리(삼각형). */
function Left({ cy, outline = false }: { cy: number; outline?: boolean }) {
  const o = outline ? OUT * 1.6 : 0;
  const half = HEAD_W / 2 + o;
  return <View style={[styles.tri, { left: -o, top: cy - half, borderTopWidth: half, borderBottomWidth: half, borderRightWidth: HEAD_L + o * 1.4,
    borderRightColor: outline ? '#000000' : '#FFFFFF' }]} />;
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  floorArrow: { position: 'absolute', bottom: '24%', width: 220, marginLeft: -110, alignItems: 'center', gap: 8 },
  glyph: { width: GLYPH_W, height: GLYPH_H },
  mirror: { transform: [{ scaleX: -1 }] },
  tri: { position: 'absolute', width: 0, height: 0, borderStyle: 'solid', backgroundColor: 'transparent', borderColor: 'transparent' },
  arrowLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, backgroundColor: '#000000', overflow: 'hidden' },
  uturn: { position: 'absolute', alignSelf: 'center', top: '35%', width: 96, height: 96, borderRadius: 48, borderWidth: 4, borderColor: '#000000', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  uturnGlyph: { color: '#000000', fontSize: 44, fontWeight: '900', lineHeight: 50 },
  uturnLabel: { color: '#000000', fontSize: 14, fontWeight: '800' },
});
