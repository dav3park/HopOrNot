import { useEffect, useMemo, useRef, useState } from "react";
import type { KakaoMapViewRef } from "@react-native-kakao/map";
import { nativeLabels, nativeRoutes } from "./native-scenes";
import { config } from "../config";
import { MapNotice } from "./map-notice";
import { DEFAULT_CENTER, RouteMapProps } from "./types";

type SDK = typeof import("@react-native-kakao/map");
export default function RouteMap(props: RouteMapProps) {
  const [sdk, setSdk] = useState<SDK>();
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const map = useRef<KakaoMapViewRef>(null);
  const fitted = useRef(-1);
  const initiallyFocused = useRef(false);
  useEffect(() => {
    if (!config.kakaoNativeKey) return;
    let active = true;
    // Dynamic import allows the rest of the app to run in Expo Go.
    import("@react-native-kakao/map")
      .then(async (module) => {
        await module.initializeKakaoMapSDK(config.kakaoNativeKey);
        if (active) setSdk(module);
      })
      .catch(() => {
        if (active)
          setError(
            "카카오 지도를 사용할 수 없습니다. 앱 등록과 개발 빌드를 확인해 주세요.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const labels = useMemo(() => nativeLabels(props), [props]);
  const routes = useMemo(() => nativeRoutes(props), [props]);
  useEffect(() => {
    const coordinates = [
      ...props.stations,
      ...props.path.flat(),
      ...props.vehicles,
    ];
    const needsInitialFocus =
      props.focusVersion === 0 &&
      !!props.focusCoordinate &&
      !initiallyFocused.current;
    if (
      !ready ||
      !coordinates.length ||
      (fitted.current === props.focusVersion && !needsInitialFocus)
    )
      return;
    fitted.current = props.focusVersion;
    if (props.focusVersion === 0 && props.focusCoordinate)
      initiallyFocused.current = true;
    const operation =
      props.focusVersion === 0 && props.focusCoordinate
        ? map.current?.moveCamera({ ...props.focusCoordinate, zoomLevel: 14 })
        : map.current?.updateCamera({ type: "fit", coordinates });
    void operation?.catch(() => setError("지도 범위를 조정하지 못했습니다."));
  }, [
    ready,
    props.stations,
    props.path,
    props.vehicles,
    props.focusVersion,
    props.focusCoordinate,
  ]);
  if (!config.kakaoNativeKey)
    return <MapNotice message="카카오 지도 연결을 준비 중입니다." />;
  if (error) return <MapNotice message={error} />;
  if (!sdk) return <MapNotice message="지도 불러오는 중" />;
  const Map = sdk.KakaoMapView;
  return (
    <Map
      ref={map}
      style={{ flex: 1 }}
      initialCamera={{ ...DEFAULT_CENTER, zoomLevel: 10 }}
      labels={labels}
      routes={routes}
      options={{ padding: { top: 160, bottom: 70, left: 100, right: 60 } }}
      onMapReady={() => setReady(true)}
      onError={() =>
        setError(
          "지도를 불러오지 못했습니다. 카카오맵 앱 등록을 확인해 주세요.",
        )
      }
      onLabelClick={({ id }) => {
        const station = props.stations.find((s) => id === `stop:${s.sequence}`);
        const vehicle = props.vehicles.find((v) => id === `bus:${v.vehicleId}`);
        if (station) props.onStation(station);
        if (vehicle) props.onVehicle(vehicle);
      }}
    />
  );
}
