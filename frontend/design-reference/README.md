# 원본 디자인 보관

출처: [dav3park/HopOrNot · design/seat-probability-view](https://github.com/dav3park/HopOrNot/tree/design/seat-probability-view)

`prototype.html`은 제공된 `design/prototype/index.html`의 원본 스냅샷입니다. 확인한 blob: `8f6cc2acfcafd97d5ad8b5a6b9a448b72f278486`. 참고 자료이며 앱에서 HTML/WebView로 실행하지 않습니다. 저장소의 MIT 라이선스 및 원본에 포함된 Preact/htm 코드의 각 라이선스가 적용됩니다.

`src/design/prototype-canvas.js`는 원본의 화면 템플릿·좌표·SVG·화면 전환 상태를 직접 가져온 JavaScript 모듈입니다. 런타임 Preact를 포함하지 않고 React + 작은 htm 템플릿 파서로 동일한 템플릿을 만듭니다. `native-renderer.tsx`가 View/Text/Pressable/Animated/react-native-svg로 변환하므로 iOS·Android에서도 네이티브 컴포넌트로 렌더링합니다.

변경은 데이터 공급부와 의미가 잘못 전달되는 문구에 한정했습니다. 노선/정류장/분포/관측/기록은 기존 repository를 사용합니다. max 3대, 고정 데모 시각, null·0·잘못된 분포 구분, 없는 날짜의 빈 기록을 유지합니다. 원본의 임의 확률/과거 기록 생성은 앱에 사용하지 않습니다. 실제 위치가 없는 API 모드에서는 버스 위치와 이동을 그리지 않습니다. mock 모드의 움직임은 화면 상단에 ‘예시 재생’으로 구분합니다.

원본 보관 파일과 직접 이식 모듈은 스타일 재해석을 방지하기 위해 일반 앱 코드의 자동 lint/format 대상과 분리했습니다. TypeScript adapter와 typed props 선언, 렌더링 테스트, 실제 브라우저 흐름으로 연결을 검증합니다.
