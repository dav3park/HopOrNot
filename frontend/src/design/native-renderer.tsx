import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useId,
} from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  ViewStyle,
  TextStyle,
  StyleProp,
} from "react-native";
import Svg, {
  Circle,
  Rect,
  Line,
  Polyline,
  Path,
  G,
  Defs,
  LinearGradient,
  Stop,
} from "react-native-svg";
// The supplied design's layout declarations are translated to native primitives.
// No DOM, iframe, or WebView is mounted on iOS/Android.
type CSS = Record<string, unknown>;
const Font = createContext<CSS>({
  color: "#000000",
  fontSize: 16,
  fontFamily:
    Platform.OS === "web"
      ? '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif'
      : undefined,
});
const classes: Record<string, string> = {
  screen: "position:absolute;inset:0;width:390px;height:844px;overflow:hidden",
  navbtn:
    "display:flex;align-items:center;flex-direction:row;gap:4px;min-height:44px;padding:0 4px;border:0;background:transparent;color:#EC0000;font-size:17px",
  jump: "min-height:44px;border:0;border-radius:12px;background:#FBF1EA;color:#000000;font-size:13px;font-weight:600;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px",
  jumpsub:
    "font-size:11px;font-weight:500;color:#696969;max-width:96px;overflow:hidden;white-space:nowrap",
  lg: "display:flex;flex-direction:row;align-items:center;gap:4px",
  lgdot: "width:10px;height:10px;border-radius:5px",
  stopdot:
    "position:absolute;top:45px;width:14px;height:14px;border-radius:7px;background:#FFFFFF;border:3px solid #D0D0D0",
  spinner:
    "width:22px;height:22px;border-radius:11px;border:2.5px solid #E9E9E9;border-top-color:#696969",
};
const textKeys = new Set([
  "fontSize",
  "fontWeight",
  "fontFamily",
  "color",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "fontVariant",
]);
const ignored = new Set([
  "boxSizing",
  "cursor",
  "whiteSpace",
  "textOverflow",
  "wordBreak",
  "userSelect",
  "touchAction",
  "fontFamily",
  "fontVariantNumeric",
  "animation",
  "transition",
  "gridTemplateColumns",
  "flexShrink",
]);
const camel = (s: string) =>
  s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
export function parseDesignStyle(css: string) {
  const style: CSS = {};
  let grid = false;
  const declarations = css
    .split(/;(?![^()]*\))/)
    .map((x) => {
      const i = x.indexOf(":");
      return [camel(x.slice(0, i).trim()), x.slice(i + 1).trim()];
    })
    .filter(([key]) => key);
  for (const [key, value] of declarations) {
    if (key === "display") {
      if (value === "flex" || value === "grid") {
        style.flexDirection = "row";
        grid = value === "grid";
      } else if (value === "none") style.display = "none";
      continue;
    }
    if (ignored.has(key)) continue;
    if (key === "inset") {
      for (const edge of ["left", "right", "top", "bottom"])
        style[edge] = Number(value) || 0;
      continue;
    }
    if (key === "padding" || key === "margin") {
      const ns = value.split(" ").map(Number.parseFloat);
      if (ns.every(Number.isFinite)) {
        const [a, b = a, c = a, d = b] = ns;
        for (const [edge, n] of [
          ["Top", a],
          ["Right", b],
          ["Bottom", c],
          ["Left", d],
        ] as const)
          style[key + edge] = n;
      } else if (value === "auto") style[key] = "auto";
      continue;
    }
    if (/^border(Top|Right|Bottom|Left)$/.test(key)) {
      const m = value.match(/^([\d.]+)(?:px)?\s+solid\s+(.+)$/);
      if (m) {
        style[key + "Width"] = Number(m[1]);
        style[key + "Color"] = m[2];
      }
      continue;
    }
    if (key === "border") {
      const m = value.match(/^([\d.]+)(?:px)?\s+solid\s+(.+)$/);
      if (m) {
        style.borderWidth = Number(m[1]);
        style.borderColor = m[2];
      } else if (value === "0") style.borderWidth = 0;
      continue;
    }
    if (key === "background") {
      if (!value.includes("gradient")) style.backgroundColor = value;
      continue;
    }
    if (key === "transform") {
      style.transform = Array.from(
        value.matchAll(
          /(translateX|translateY|scale|rotate)\(([-\d.]+)(px|deg)?\)/g,
        ),
      ).map((m) => ({
        [m[1]]: m[1] === "rotate" ? `${m[2]}deg` : Number(m[2]),
      }));
      continue;
    }
    if (key === "boxShadow") {
      if (Platform.OS === "web") style.boxShadow = value;
      continue;
    }
    if (key === "fontWeight") {
      style[key] = value === "800" ? "700" : value;
      continue;
    }
    style[key] = /^-?[\d.]+(?:px)?$/.test(value)
      ? Number.parseFloat(value)
      : value;
  }
  if (style.fontSize === 40 && style.lineHeight === undefined)
    style.lineHeight = 46;
  return { style, grid };
}
const svgTags: Record<string, React.ElementType> = {
  svg: Svg,
  rect: Rect,
  circle: Circle,
  line: Line,
  polyline: Polyline,
  path: Path,
  g: G,
  defs: Defs,
  linearGradient: LinearGradient,
  stop: Stop,
};
const nativeProps = (props: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(props).map(([key, v]) => [
      key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
      v,
    ]),
  );
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
// Animated.Value instances are imperative animation handles, not React render state.
/* eslint-disable react-hooks/refs */
function useDesignMotion(target: CSS, declaration: string): CSS {
  const values = useRef<Record<string, Animated.Value>>({});
  const result = { ...target };
  const changes: { key: string; value: number }[] = [];
  for (const key of ["left", "top", "width", "height", "opacity"])
    if (typeof target[key] === "number")
      changes.push({ key, value: target[key] as number });
  const transforms = (target.transform ?? []) as Record<
    string,
    number | string
  >[];
  transforms.forEach((item, index) => {
    const [key, value] = Object.entries(item)[0];
    changes.push({
      key: `transform:${index}:${key}`,
      value: typeof value === "string" ? parseFloat(value) : value,
    });
  });
  for (const { key, value } of changes) {
    values.current[key] ??= new Animated.Value(value);
    if (!key.startsWith("transform")) result[key] = values.current[key];
  }
  if (transforms.length)
    result.transform = transforms.map((item, index) => {
      const [key] = Object.entries(item)[0];
      const v = values.current[`transform:${index}:${key}`];
      return {
        [key]:
          key === "rotate"
            ? v.interpolate({
                inputRange: [0, 360],
                outputRange: ["0deg", "360deg"],
              })
            : v,
      };
    });
  const signature = JSON.stringify(changes);
  useEffect(() => {
    const parsed = JSON.parse(signature) as { key: string; value: number }[];
    const active: Animated.CompositeAnimation[] = [];
    for (const { key, value } of parsed) {
      const base = key.startsWith("transform") ? "transform" : key;
      const segment = declaration
        .split(/,\s+(?=[a-z-]+\s)/)
        .find((part) => part.startsWith(base + " ") || part.startsWith("all "));
      const times = Array.from((segment ?? "").matchAll(/([\d.]+)s/g));
      const v = values.current[key];
      if (!v) continue;
      if (!times.length || declaration === "none") {
        v.setValue(value);
        continue;
      }
      const animation = Animated.timing(v, {
        toValue: value,
        duration: Number(times[0][1]) * 1000,
        delay: times[1] ? Number(times[1][1]) * 1000 : 0,
        easing: segment?.includes("linear")
          ? Easing.linear
          : base === "transform"
            ? Easing.out(Easing.back(1.1))
            : Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      });
      active.push(animation);
      animation.start();
    }
    return () => active.forEach((a) => a.stop());
  }, [signature, declaration]);
  return result;
}
/* eslint-enable react-hooks/refs */
function GradientBackground({ value }: { value: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const args: string[] = [];
  let part = "";
  let depth = 0;
  for (const c of value.slice(value.indexOf("(") + 1, -1)) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      args.push(part.trim());
      part = "";
    } else part += c;
  }
  args.push(part.trim());
  const angle = parseInt(args[0]);
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient
            id={id}
            x1={angle === 270 ? "100%" : "0%"}
            y1="0%"
            x2={angle === 90 ? "100%" : "0%"}
            y2={angle === 180 ? "100%" : "0%"}
          >
            <Stop offset="0%" stopColor={args[1]} />
            <Stop offset="100%" stopColor={args[2]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
type ElementProps = {
  tag: string;
  style?: string;
  class?: string;
  children?: React.ReactNode;
  onClick?: () => void;
  onPointerDown?: (e: unknown) => void;
  onPointerMove?: (e: unknown) => void;
  onPointerUp?: (e: unknown) => void;
  onPointerCancel?: (e: unknown) => void;
  [key: string]: unknown;
};
function NativeElement({
  tag,
  children,
  style = "",
  class: className = "",
  ...props
}: ElementProps) {
  const inherited = useContext(Font);
  const { style: resolved, grid } = parseDesignStyle(
    className
      .split(" ")
      .map((c) => classes[c] ?? "")
      .join(";") +
      ";" +
      style,
  );
  const font: CSS = { ...inherited };
  const layout: CSS = {};
  for (const [k, v] of Object.entries(resolved)) {
    if (textKeys.has(k)) font[k] = v;
    else layout[k] = v;
  }
  const transition = style.match(/transition:\s*([^;]+)/)?.[1] ?? "none";
  const moving = useDesignMotion(layout, transition);
  const [animation] = useState(() => new Animated.Value(0));
  const animatedClass = className
    .split(" ")
    .find((c) => ["slide", "spinner", "pulse", "ring"].includes(c));
  useEffect(() => {
    if (!animatedClass) return;
    const loop = Animated.loop(
      Animated.timing(animation, {
        toValue: 1,
        duration:
          animatedClass === "slide"
            ? 4800
            : animatedClass === "spinner"
              ? 800
              : 1600,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [animation, animatedClass]);
  const extra: CSS =
    animatedClass === "slide"
      ? {
          transform: [
            {
              translateX: animation.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [-70, 70, -70],
              }),
            },
          ],
        }
      : animatedClass === "spinner"
        ? {
            transform: [
              {
                rotate: animation.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0deg", "360deg"],
                }),
              },
            ],
          }
        : animatedClass
          ? {
              transform: [
                {
                  scale: animation.interpolate({
                    inputRange: [0, 1],
                    outputRange: [
                      animatedClass === "pulse" ? 0.85 : 1,
                      animatedClass === "pulse" ? 1.4 : 1.9,
                    ],
                  }),
                },
              ],
              opacity: animation.interpolate({
                inputRange: [0, 1],
                outputRange: [0.9, 0],
              }),
            }
          : {};
  const SvgComponent = svgTags[tag];
  if (SvgComponent) {
    const svgProps = nativeProps(props);
    delete svgProps["ariaHidden"];
    return (
      <SvgComponent color={font.color as string} {...svgProps} style={resolved}>
        {children}
      </SvgComponent>
    );
  }
  const raw = React.Children.toArray(children);
  const content =
    raw.length > 0 &&
    raw.every((child) => typeof child === "string" || typeof child === "number")
      ? [
          <Text key="text" allowFontScaling={false} style={font as TextStyle}>
            {raw.join("")}
          </Text>,
        ]
      : raw.map((child, i) =>
          typeof child === "string" || typeof child === "number" ? (
            <Text key={i} allowFontScaling={false} style={font as TextStyle}>
              {child}
            </Text>
          ) : (
            child
          ),
        );
  const isText =
    ["span", "h1"].includes(tag) &&
    !resolved.flexDirection &&
    !React.Children.toArray(children).some(
      (c) =>
        React.isValidElement<ElementProps>(c) &&
        (c.props.tag === "svg" || c.props.class === "lgdot"),
    );
  if (isText)
    return (
      <Text
        allowFontScaling={false}
        numberOfLines={
          style.includes("nowrap") || className.includes("ell") ? 1 : undefined
        }
        style={[font, layout] as TextStyle[]}
      >
        {children}
      </Text>
    );
  const hidden =
    /opacity:\s*0(?:;|$)/.test(style) && /pointer-events:\s*none/.test(style);
  const common = {
    accessibilityElementsHidden: hidden,
    importantForAccessibility: hidden
      ? ("no-hide-descendants" as const)
      : ("auto" as const),
    accessibilityLabel: props["aria-label"] as string | undefined,
    accessibilityState:
      props["aria-pressed"] === undefined
        ? undefined
        : { selected: !!props["aria-pressed"] },
    pointerEvents: /pointer-events:/.test(style)
      ? ((style.includes("pointer-events: none") ? "none" : "auto") as
          "none" | "auto")
      : undefined,
  };
  const body = grid
    ? content.map((child, i) => (
        <View key={i} style={{ flex: 1, minWidth: 0 }}>
          {child}
        </View>
      ))
    : content;
  const gradient = style.match(/background:\s*(linear-gradient\([^;]+\))/)?.[1];
  const wrapped = (
    <Font.Provider value={font}>
      {gradient && <GradientBackground value={gradient} />}
      {body}
    </Font.Provider>
  );
  const listeners = Object.fromEntries(
    ["onPointerDown", "onPointerMove", "onPointerUp", "onPointerCancel"]
      .filter((k) => props[k])
      .map((k) => [
        k,
        (event: { nativeEvent: { pageX: number; pageY: number } }) =>
          (props[k] as (e: unknown) => void)({
            clientX: event.nativeEvent.pageX,
            clientY: event.nativeEvent.pageY,
            currentTarget: { setPointerCapture: () => {} },
            pointerId: 0,
          }),
      ]),
  );
  if (tag === "button" || tag === "a")
    return (
      <AnimatedPressable
        {...common}
        accessibilityRole="button"
        onPress={props.onClick}
        style={
          [
            {
              flexShrink: 0,
              alignItems: font.textAlign === "left" ? "flex-start" : "center",
              justifyContent: "center",
            },
            moving,
          ] as StyleProp<ViewStyle>
        }
      >
        {wrapped}
      </AnimatedPressable>
    );
  if (style.includes("overflow-y: auto"))
    return (
      <ScrollView
        {...common}
        style={layout as ViewStyle}
        contentContainerStyle={{ paddingBottom: 28 }}
      >
        {wrapped}
      </ScrollView>
    );
  return (
    <Animated.View
      {...common}
      {...listeners}
      style={[moving, extra] as StyleProp<ViewStyle>}
    >
      {wrapped}
    </Animated.View>
  );
}
export function nativeH(
  tag: string | React.ElementType,
  props: Record<string, unknown> | null,
  ...children: React.ReactNode[]
): React.ReactElement {
  if (typeof tag !== "string")
    return React.createElement(tag, props, ...children);
  const { key, ...rest } = props ?? {};
  return React.createElement(
    NativeElement,
    { ...rest, key: key as string | undefined, tag },
    ...children,
  );
}
