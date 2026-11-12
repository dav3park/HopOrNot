import Svg, { Path, Rect, Circle } from "react-native-svg";
export function BusIcon({
  color = "white",
  size = 22,
}: {
  color?: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x="5"
        y="3"
        width="14"
        height="16"
        rx="4"
        stroke={color}
        strokeWidth="2"
      />
      <Path
        d="M5 12h14M8 19v2m8-2v2M9 6h6"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <Circle cx="8" cy="16" r="1" fill={color} />
      <Circle cx="16" cy="16" r="1" fill={color} />
    </Svg>
  );
}
