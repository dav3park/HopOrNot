// Small typed surface of the official JavaScript SDK used by this app.
export interface KakaoPoint {
  getLat(): number;
  getLng(): number;
}
interface MapHandle {
  getProjection(): {
    containerPointFromCoords(point: KakaoPoint): { x: number; y: number };
  };
  setLevel(level: number): void;
  setBounds(
    bounds: object,
    paddingTop?: number,
    paddingRight?: number,
    paddingBottom?: number,
    paddingLeft?: number,
  ): void;
  setCenter(point: KakaoPoint): void;
  relayout(): void;
}
interface Overlay {
  setMap(map: MapHandle | null): void;
}
export interface KakaoMaps {
  event: {
    addListener(target: object, name: string, callback: () => void): void;
    removeListener(target: object, name: string, callback: () => void): void;
  };
  load(callback: () => void): void;
  LatLng: new (latitude: number, longitude: number) => KakaoPoint;
  LatLngBounds: new () => {
    extend(point: KakaoPoint): void;
    isEmpty(): boolean;
  };
  Map: new (
    element: HTMLElement,
    options: { center: KakaoPoint; level: number },
  ) => MapHandle;
  Polyline: new (options: {
    map: MapHandle;
    path: KakaoPoint[];
    strokeWeight: number;
    strokeColor: string;
    strokeOpacity: number;
  }) => Overlay;
  CustomOverlay: new (options: {
    map: MapHandle;
    position: KakaoPoint;
    content: HTMLElement;
    zIndex: number;
    yAnchor: number;
  }) => Overlay;
}
declare global {
  interface Window {
    kakao?: { maps: KakaoMaps };
  }
}
let pending: Promise<KakaoMaps> | undefined;
export function loadKakaoMaps(key: string): Promise<KakaoMaps> {
  if (!key) return Promise.reject(new Error("카카오 지도 키를 설정해 주세요."));
  if (pending) return pending;
  pending = new Promise<KakaoMaps>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => fail(), 15000);
    let settled = false;
    function fail() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.remove();
      reject(
        new Error(
          "지도를 불러오지 못했습니다. 네트워크와 카카오 키·등록 도메인을 확인해 주세요.",
        ),
      );
    }
    function ready() {
      try {
        if (!window.kakao?.maps?.load) return fail();
        window.kakao.maps.load(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(window.kakao!.maps);
        });
      } catch {
        fail();
      }
    }
    if (window.kakao?.maps?.load) ready();
    else {
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
      script.async = true;
      script.onload = ready;
      script.onerror = fail;
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
