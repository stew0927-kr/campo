import { describe, expect, it, vi } from 'vitest';
import { savedPhotosButton } from '../src/ui/savedPhotos.ts';

describe('저장된 사진 단추', () => {
  it('저장된 사진이 있으면 장수를 적은 단추를 만든다', () => {
    const button = savedPhotosButton(3, () => {});
    expect(button?.label).toBe('저장된 사진 3장 보기·삭제');
    expect(button?.count).toBe(3);
  });

  it('누르면 그 지점의 사진 창을 연다', () => {
    const onManage = vi.fn();
    savedPhotosButton(2, onManage)?.onPress();
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it('저장된 사진이 없거나 장수를 모르면 단추를 만들지 않는다', () => {
    expect(savedPhotosButton(0, () => {})).toBeNull();
    expect(savedPhotosButton(undefined, () => {})).toBeNull();
  });

  it('사진 창을 열 수 없으면 단추를 만들지 않는다', () => {
    expect(savedPhotosButton(2, undefined)).toBeNull();
  });
});
