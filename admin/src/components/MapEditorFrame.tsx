// 매핑 탭의 지도 편집 화면: packages/editor를 서버 모드로 빌드한 페이지(/map/, admin/scripts/build-map.mjs)를 iframe으로 띄운다.
// 같은 주소(origin)라 관리자 웹의 로그인을 편집기도 그대로 쓴다. 편집기 CSS·React는 iframe 안에만 있어 관리자 화면과 섞이지 않는다.
// App이 한 번 연 뒤로 계속 마운트해 두므로(숨기기만 함) 다른 탭에 다녀와도 저장하지 않은 편집이 남는다.
import { useEffect, useRef } from 'react';

interface Props {
  visible: boolean;
  /** Bumped by "편집 화면 다시 불러오기": reloads the page inside, so the editor's own "저장하지 않은 변경" question still runs. */
  reload: number;
}

export function MapEditorFrame({ visible, reload }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const lastReload = useRef(reload);

  useEffect(() => {
    if (reload === lastReload.current) return;
    lastReload.current = reload;
    frame.current?.contentWindow?.location.reload();
  }, [reload]);

  // `npm run dev` has no /map/ (the dev server would answer with the admin page itself).
  if (import.meta.env.DEV) {
    return visible ? (
      <div className="map-dev-note">
        <p>지도 편집 화면은 개발 서버(npm run dev)에서는 열리지 않습니다.</p>
        <p>admin 폴더에서 <code>npm run build</code> 후 <code>npm run preview</code>로 확인하거나, 배포 주소에서 여세요.</p>
      </div>
    ) : null;
  }
  return <iframe ref={frame} className="map-frame" src={`${import.meta.env.BASE_URL}map/`} title="지도 편집기" hidden={!visible} />;
}
