import { jest, it, expect, afterEach, beforeEach } from "@jest/globals";
import { render, screen, fireEvent, act } from "@testing-library/react-native";
import {
  PrototypeCanvas,
  PrototypeProps,
} from "../src/design/prototype-canvas";
import { parseDesignStyle } from "../src/design/native-renderer";
import { stations, vehicles, history, DEMO_NOW } from "../src/mocks/fixtures";
function props(): PrototypeProps {
  return {
    route: "5100",
    routeViews: Object.fromEntries(
      ["5100", "M5107", "1112"].map((name) => [
        name,
        {
          kind: "직행좌석",
          color: "#E5332A",
          soft: "#FDECEB",
          trail: "rgba(229,51,42,.45)",
          stops: stations.map((s) => s.name),
        },
      ]),
    ),
    vehicles: vehicles("normal"),
    stations,
    selection: {
      routeId: "mock-route-5100",
      direction: "TO_SEOUL",
      stationId: stations[4].stationId,
      stationSequence: stations[4].sequence,
    },
    mode: "mock",
    scale: 1,
    now: DEMO_NOW,
    stationIndex: 4,
    initialScreen: "select",
    historyRecords: history,
    onRoute: jest.fn(),
    onStation: jest.fn(),
    onHistory: jest.fn(),
    onScreen: jest.fn(),
  };
}
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
it("원본 로딩→노선 카드→기타줄 비교→버스 선택→가로 노선 전환", async () => {
  jest.useFakeTimers();
  const p = props();
  await render(<PrototypeCanvas {...p} initialScreen="loading" />);
  expect(screen.getByText("HopOrNot")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("노선 선택으로 이동"));
  expect(screen.getByText("노선 선택")).toBeTruthy();
  await fireEvent.press(screen.getByText("5100"));
  expect(p.onRoute).toHaveBeenCalledWith("5100");
  expect(screen.getByText("지금 잔여석")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("5석 이상 기준으로 보기"));
  expect(screen.getAllByText("도착 시 5석 이상").length).toBeGreaterThan(0);
  await fireEvent.press(screen.getByLabelText(/이번 버스, 지금/));
  await act(async () => {
    jest.advanceTimersByTime(1100);
  });
  expect(screen.getByText("이번 버스", { exact: true })).toBeTruthy();
  expect(screen.getByText("내 버스")).toBeTruthy();
  await fireEvent.press(screen.getByText("도착 순서"));
  expect(
    screen.getByLabelText("5석 이상 기준으로 보기").props.accessibilityState
      .selected,
  ).toBe(true);
});
it("원본 지난 기록 레이아웃에서도 빈 날짜의 기록을 생성하지 않음", async () => {
  const p = props();
  const result = await render(<PrototypeCanvas {...p} initialScreen="live" />);
  await fireEvent.press(screen.getByText("지난 기록"));
  expect(p.onHistory).toHaveBeenLastCalledWith(true, "today");
  expect(screen.getByText("07:10")).toBeTruthy();
  await result.rerender(
    <PrototypeCanvas {...p} historyRecords={[]} initialScreen="live" />,
  );
  expect(
    screen.getByText("기록 없음 · 수집 범위 밖일 수 있습니다"),
  ).toBeTruthy();
  expect(screen.queryByText("07:10")).toBeNull();
});
it("원본 표에서 유효한 0과 결측·잘못된 분포 구분", async () => {
  const p = props();
  await render(
    <PrototypeCanvas
      {...p}
      vehicles={vehicles("partial")}
      initialScreen="live"
    />,
  );
  expect(screen.getAllByText("오류").length).toBeGreaterThan(0);
  expect(screen.getAllByText("92%").length).toBeGreaterThan(0);
});
it("원본 좌표/그리드/테두리/변환을 네이티브 스타일로 보존", () => {
  const p = parseDesignStyle(
    "position:absolute;left:16px;right:16px;top:190px;height:114px;padding:10px 14px;border-radius:18px;background:#FFFFFF",
  );
  expect(p.style).toMatchObject({
    left: 16,
    right: 16,
    top: 190,
    height: 114,
    paddingTop: 10,
    paddingLeft: 14,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
  });
  expect(
    parseDesignStyle(
      "display:grid;grid-template-columns:repeat(3,minmax(0,1fr))",
    ).grid,
  ).toBe(true);
  expect(
    parseDesignStyle(
      "border-top:0.5px solid #D1D1D6;transform:rotate(90deg) scale(1.98)",
    ).style,
  ).toMatchObject({
    borderTopWidth: 0.5,
    borderTopColor: "#D1D1D6",
    transform: [{ rotate: "90deg" }, { scale: 1.98 }],
  });
});

it.each([
  ["normal", 3],
  ["one", 1],
  ["two", 2],
  ["empty", 0],
] as const)(
  "기점 선택에서도 응답 %s의 %s대만 표시",
  async (scenario, count) => {
    const p = props();
    await render(
      <PrototypeCanvas
        {...p}
        initialScreen="live"
        stationIndex={0}
        selection={{
          ...p.selection,
          stationId: stations[0].stationId,
          stationSequence: stations[0].sequence,
        }}
        vehicles={vehicles(scenario)}
      />,
    );
    expect(
      screen.queryAllByLabelText(/버스, 지금.*실시간 노선 보기/),
    ).toHaveLength(count);
  },
);
