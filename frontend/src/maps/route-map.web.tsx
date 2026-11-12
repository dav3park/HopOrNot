import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { config } from "../config";
import { Button } from "../components/ui";
import { MapNotice } from "./map-notice";
import { KakaoMaps, loadKakaoMaps } from "./kakao-web-sdk";
import { stationAnchor } from "./station-anchor";
import { DEFAULT_CENTER, RouteMapProps } from "./types";

export default function RouteMap(props: RouteMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const [sdk, setSdk] = useState<KakaoMaps>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const map = useRef<InstanceType<KakaoMaps["Map"]> | null>(null);
  const fitted = useRef(-1);
  const initiallyFocused = useRef(false);
  useEffect(() => {
    let active = true;
    loadKakaoMaps(config.kakaoJavascriptKey).then(
      (value) => {
        if (active) setSdk(value);
      },
      (err: Error) => {
        if (active) setError(err.message);
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  useEffect(() => {
    if (!sdk || !container.current) return;
    const element = container.current;
    try {
      map.current = new sdk.Map(element, {
        center: new sdk.LatLng(
          DEFAULT_CENTER.latitude,
          DEFAULT_CENTER.longitude,
        ),
        level: 8,
      });
      const observer = new ResizeObserver(() => map.current?.relayout());
      observer.observe(element);
      return () => {
        observer.disconnect();
        map.current = null;
        element.replaceChildren();
      };
    } catch {
      // SDK construction is an external operation; surface its synchronous failure.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(
        "지도 초기화에 실패했습니다. 카카오맵 사용 설정과 도메인을 확인해 주세요.",
      );
    }
  }, [sdk]);
  useEffect(() => {
    const current = map.current;
    if (!sdk || !current) return;
    const overlays: { setMap(map: null): void }[] = [];
    const removers: (() => void)[] = [];
    const bounds = new sdk.LatLngBounds();
    const cards: {
      element: HTMLButtonElement;
      position: ReturnType<typeof point>;
      selected: boolean;
    }[] = [];
    const point = (p: { latitude: number; longitude: number }) =>
      new sdk.LatLng(p.latitude, p.longitude);
    const label = (
      position: ReturnType<typeof point>,
      text: string,
      color: string,
      onClick: () => void,
      probability?: string,
      tag?: string,
      kind: "card" | "vehicle" = "vehicle",
    ) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.setAttribute("aria-label", text);
      if (probability) {
        const title = document.createElement("span");
        title.textContent = text;
        title.style.display = "block";
        title.style.fontSize = "11px";
        title.style.maxWidth = "132px";
        title.style.overflow = "hidden";
        title.style.textOverflow = "ellipsis";
        const number = document.createElement("strong");
        number.textContent = probability;
        number.style.display = "block";
        number.style.fontSize = "24px";
        button.replaceChildren(title, number);
        button.setAttribute(
          "aria-label",
          `${text} ${probability}${tag ? ` ${tag}` : ""}`,
        );
      }
      Object.assign(button.style, {
        background: color,
        color: ["#F5DECF", "#EA6F5D", "#E9E9E9"].includes(color)
          ? "#000000"
          : "#FFFFFF",
        border: "2px solid white",
        borderRadius: "16px",
        padding: probability ? "7px 12px" : "10px 12px",
        minHeight: "44px",
        fontSize: "12px",
        fontWeight: "700",
        boxShadow: "0 2px 6px #0002",
        cursor: "pointer",
        whiteSpace: "nowrap",
      });
      if (tag) {
        const badge = document.createElement("span");
        badge.textContent = tag;
        Object.assign(badge.style, {
          position: "absolute",
          top: "-23px",
          left: "50%",
          transform: "translateX(-50%)",
          background: "#990000",
          color: "white",
          padding: "3px 8px",
          borderRadius: "12px",
          fontSize: "10px",
        });
        button.style.position = "relative";
        button.appendChild(badge);
      }
      button.addEventListener("click", onClick);
      removers.push(() => button.removeEventListener("click", onClick));
      const host = document.createElement("div");
      Object.assign(host.style, {
        position: "relative",
        width: "0px",
        height: "0px",
      });
      if (kind === "card") {
        Object.assign(button.style, {
          position: "absolute",
          right: "24px",
          top: "-30px",
          maxWidth: "160px",
        });
        button.dataset.stationCard = "true";
        host.appendChild(button);
      }
      overlays.push(
        new sdk.CustomOverlay({
          map: current,
          position,
          content: kind === "card" ? host : button,
          zIndex: kind === "card" ? 30 : 60,
          yAnchor: kind === "card" ? 0 : 1,
        }),
      );
      return button;
    };
    props.routeLines?.forEach((line) =>
      line.path.forEach((segment) =>
        overlays.push(
          new sdk.Polyline({
            map: current,
            path: segment.map(point),
            strokeWeight: 4,
            strokeColor: line.color,
            strokeOpacity: 0.65,
          }),
        ),
      ),
    );
    props.path.forEach((segment) => {
      const path = segment.map(point);
      path.forEach((p) => bounds.extend(p));
      overlays.push(
        new sdk.Polyline({
          map: current,
          path,
          strokeWeight: 6,
          strokeColor: props.routeColor ?? "#EC0000",
          strokeOpacity: 1,
        }),
      );
    });
    props.stations.forEach((s, index) => {
      const p = point(stationAnchor(s, props.path));
      bounds.extend(point(s));
      const dot = document.createElement("button");
      dot.type = "button";
      dot.dataset.stationDot = String(s.sequence);
      dot.setAttribute("aria-label", `${s.name} 정류장 선택`);
      Object.assign(dot.style, {
        width: "44px",
        height: "44px",
        minWidth: "44px",
        minHeight: "44px",
        padding: "0",
        border: "0",
        background: "transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      });
      const ring = document.createElement("span");
      ring.dataset.stationRing = String(s.sequence);
      Object.assign(ring.style, {
        boxSizing: "border-box",
        width: s.sequence === props.selectedSequence ? "21px" : "17px",
        height: s.sequence === props.selectedSequence ? "21px" : "17px",
        border: `4px solid ${props.routeColor ?? "#EC0000"}`,
        borderRadius: "50%",
        background: "white",
        boxShadow:
          s.sequence === props.selectedSequence
            ? "0 0 0 5px #ffffffAA, 0 2px 5px #0005"
            : "0 0 0 2px white, 0 2px 5px #0004",
        pointerEvents: "none",
      });
      dot.appendChild(ring);
      const select = () => props.onStation(s);
      dot.addEventListener("click", select);
      removers.push(() => dot.removeEventListener("click", select));
      overlays.push(
        new sdk.CustomOverlay({
          map: current,
          position: p,
          content: dot,
          zIndex: 100,
          yAnchor: 0.5,
        }),
      );
      const element = label(
        p,
        `${index + 1}. ${s.name}`,
        props.stationLabels?.[s.sequence]?.color ??
          (s.sequence === props.selectedSequence ? "#EC0000" : "#333333"),
        () => props.onStation(s),
        props.stationLabels?.[s.sequence]?.probability,
        props.stationLabels?.[s.sequence]?.tag,
        "card",
      );
      cards.push({
        element,
        position: p,
        selected: s.sequence === props.selectedSequence,
      });
    });
    props.vehicles.forEach((v, index) => {
      const p = point(v);
      bounds.extend(p);
      label(
        p,
        `버스 ${index + 1} · ${v.remainingSeats === null ? "좌석 —" : `${v.remainingSeats}석`}`,
        "#EC0000",
        () => props.onVehicle(v),
      );
    });
    // Polling updates markers without resetting a user's zoom/pan.
    if (
      !bounds.isEmpty() &&
      (fitted.current !== props.focusVersion ||
        (props.focusVersion === 0 &&
          props.focusCoordinate &&
          !initiallyFocused.current))
    ) {
      if (props.focusVersion === 0 && props.focusCoordinate) {
        current.setCenter(point(props.focusCoordinate));
        current.setLevel(5);
        initiallyFocused.current = true;
      } else current.setBounds(bounds, 160, 70, 70, 110);
      fitted.current = props.focusVersion;
    }
    // Every stop keeps its real coordinate and accessible name. Expand cards only
    // where they fit; nearby stops stay as clickable dots until zoomed/selected.
    const layoutLabels = () => {
      if (!container.current) return;
      const projection = current.getProjection();
      const occupied: {
        left: number;
        right: number;
        top: number;
        bottom: number;
      }[] = [];
      const width = container.current.clientWidth,
        height = container.current.clientHeight;
      [...cards]
        .sort((a, b) => Number(b.selected) - Number(a.selected))
        .forEach((card) => {
          const { element } = card;
          element.style.visibility = "visible";
          const p = projection.containerPointFromCoords(card.position);
          const cardWidth = element.offsetWidth,
            cardHeight = element.offsetHeight;
          const showRight = p.x - 24 - cardWidth < 8;
          element.style.right = showRight ? "auto" : "24px";
          element.style.left = showRight ? "24px" : "auto";
          const topInset = props.controlsInset ?? 140;
          const labelTop =
            p.y - cardHeight / 2 - 24 < topInset ? 28 : -cardHeight / 2;
          element.style.top = `${labelTop}px`;
          const rect = {
            left: showRight ? p.x + 24 : p.x - 24 - cardWidth,
            right: showRight ? p.x + 24 + cardWidth : p.x - 24,
            top: p.y + labelTop - 8,
            bottom: p.y + labelTop + cardHeight + 8,
          };
          const overlaps = occupied.some(
            (other) =>
              rect.left < other.right + 8 &&
              rect.right > other.left - 8 &&
              rect.top < other.bottom + 8 &&
              rect.bottom > other.top - 8,
          );
          const visible =
            p.x > 0 &&
            p.x < width &&
            rect.top > topInset &&
            rect.bottom < height - 55;
          if (card.selected || (visible && !overlaps && occupied.length < 6))
            occupied.push(rect);
          else element.style.visibility = "hidden";
        });
    };
    sdk.event.addListener(current, "idle", layoutLabels);
    const frame = requestAnimationFrame(layoutLabels);
    return () => {
      cancelAnimationFrame(frame);
      sdk.event.removeListener(current, "idle", layoutLabels);
      removers.forEach((remove) => remove());
      overlays.forEach((o) => o.setMap(null));
    };
  }, [sdk, props]);
  if (!config.kakaoJavascriptKey)
    return <MapNotice message="카카오 지도 연결을 준비 중입니다." />;
  if (error)
    return (
      <View style={{ flex: 1 }}>
        <MapNotice message={error} />
        <Button
          title="지도 다시 불러오기"
          onPress={() => {
            setError("");
            setSdk(undefined);
            fitted.current = -1;
            setAttempt((v) => v + 1);
          }}
        />
      </View>
    );
  return (
    <div
      ref={container}
      role="region"
      aria-label="카카오 버스 노선 지도"
      style={{
        flex: 1,
        width: "100%",
        minHeight: 0,
        background: "#DEEDF2",
        position: "relative",
        zIndex: 0,
        isolation: "isolate",
        overflow: "hidden",
      }}
    />
  );
}
