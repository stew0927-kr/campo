// 사진 위 진행 방향 화살표(코어 arrowFor의 ArrowModel). 확대 뷰어와 캠퍼스 로드뷰가 함께 쓴다.
// 화살표는 흰 채움 + 검은 테두리 모양과 글로 함께 전달한다(색만 쓰지 않는다).
import { StyleSheet, Text, View } from 'react-native';
import type { PhotoArrow } from '../contracts.ts';

/**
 * 사진 위 화살표.
 * - inFrame: 아래 가운데 "바닥 화살표"를 Δθ만큼 돌리고, 사진 속 그 방향 위치(xRatio)에 둥근 표식을 하나 더 찍는다.
 * - edge: 그 방향 가장자리(왼쪽/오른쪽) 가운데에 바깥을 가리키는 화살표.
 * - behind: 가운데에 U턴 표시.
 */
export function ArrowOverlay({ arrow }: { arrow: PhotoArrow }) {
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
  if (arrow.mode === 'edge') {
    const right = arrow.rotateDeg > 0;
    return (
      <View style={[styles.overlay, styles.edgeWrap, right ? styles.edgeRight : styles.edgeLeft]} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <ArrowGlyph rotateDeg={right ? 90 : -90} />
        <Text style={styles.arrowLabel}>{arrow.label}</Text>
      </View>
    );
  }
  return (
    <View style={styles.overlay} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      {arrow.xRatio !== undefined && <View style={[styles.target, { left: `${arrow.xRatio * 100}%` }]} />}
      <View style={styles.floorArrow}>
        <ArrowGlyph rotateDeg={arrow.rotateDeg} />
        <Text style={styles.arrowLabel}>{arrow.label}</Text>
      </View>
    </View>
  );
}

/** 위를 가리키는 화살표(흰 채움, 검은 테두리)를 rotateDeg만큼 돌린다. 테두리는 검은 모양 위에 흰 모양을 겹쳐 만든다. */
function ArrowGlyph({ rotateDeg }: { rotateDeg: number }) {
  return (
    <View style={[styles.glyph, { transform: [{ rotate: `${rotateDeg}deg` }] }]}>
      <View style={[styles.head, styles.headOutline]} />
      <View style={[styles.head, styles.headFill]} />
      <View style={styles.shaft} />
    </View>
  );
}

const HEAD = 26;
const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  floorArrow: { position: 'absolute', left: 0, right: 0, bottom: '32%', alignItems: 'center', gap: 6 },
  target: { position: 'absolute', top: '42%', width: 28, height: 28, marginLeft: -14, borderRadius: 14, borderWidth: 3, borderColor: '#000000', backgroundColor: '#FFFFFF' },
  edgeWrap: { justifyContent: 'center', gap: 6, paddingHorizontal: 12 },
  edgeLeft: { alignItems: 'flex-start' },
  edgeRight: { alignItems: 'flex-end' },
  glyph: { width: 56, height: 72, alignItems: 'center' },
  head: { position: 'absolute', width: 0, height: 0, borderStyle: 'solid', backgroundColor: 'transparent', borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  headOutline: { top: 0, borderLeftWidth: HEAD + 4, borderRightWidth: HEAD + 4, borderBottomWidth: HEAD * 1.4 + 6, borderBottomColor: '#000000' },
  headFill: { top: 4, borderLeftWidth: HEAD, borderRightWidth: HEAD, borderBottomWidth: HEAD * 1.4, borderBottomColor: '#FFFFFF' },
  shaft: { position: 'absolute', top: HEAD * 1.4 + 2, width: 20, height: 34, backgroundColor: '#FFFFFF', borderWidth: 3, borderTopWidth: 0, borderColor: '#000000' },
  arrowLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: '#000000', overflow: 'hidden' },
  uturn: { position: 'absolute', alignSelf: 'center', top: '35%', width: 96, height: 96, borderRadius: 48, borderWidth: 4, borderColor: '#000000', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  uturnGlyph: { color: '#000000', fontSize: 44, fontWeight: '900', lineHeight: 50 },
  uturnLabel: { color: '#000000', fontSize: 14, fontWeight: '800' },
});
