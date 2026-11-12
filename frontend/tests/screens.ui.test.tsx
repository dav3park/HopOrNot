import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { FlameApp } from "../src/design/flame-app";
import { SeatProbabilityView } from "../src/components/seat-probability-view";
import { ResultScreen } from "../src/features/result-screen";
import Select from "../app/manual";
import { useSection, useStations, useRoutes } from "../src/features/queries";
import { useBus } from "../src/features/provider";
import {
  envelope,
  vehicles,
  stations,
  routes,
  history,
  alternatives,
  forecast,
  Scenario,
} from "../src/mocks/fixtures";
import { Selection } from "../src/domain/types";
import { useLocalSearchParams } from "expo-router";
const selection: Selection = {
  routeId: "mock-route-5100",
  direction: "TO_CAMPUS",
  stationId: "mock-station-01",
  stationSequence: 1,
};
jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn() },
}));
jest.mock("../src/features/queries");
jest.mock("../src/features/provider", () => ({ useBus: jest.fn() }));
function setup(scenario: Scenario = "normal") {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ ...selection, stationSequence: "1" });
  jest.mocked(useBus).mockReturnValue({
    favorites: [],
    ready: true,
    toggle: jest.fn(),
    scenario,
  } as unknown as ReturnType<typeof useBus>);
  jest.mocked(useStations).mockReturnValue({
    data: envelope(stations),
    isPending: false,
    isFetching: false,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useStations>);
  jest.mocked(useRoutes).mockReturnValue({
    data: envelope(routes),
    isPending: false,
    isFetching: false,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useRoutes>);
  jest.mocked(useSection).mockImplementation(((method: string) => {
    const data =
      method === "getPredictions"
        ? vehicles(scenario)
        : method === "getHistory"
          ? scenario === "noHistory"
            ? []
            : history
          : method === "getAlternatives"
            ? alternatives(selection, scenario)
            : forecast;
    return {
      data: envelope(data, scenario === "stale"),
      isPending: false,
      isFetching: false,
      error: null,
      refetch: jest.fn(),
    };
  }) as unknown as typeof useSection);
}
beforeEach(() => {
  jest.clearAllMocks();
  setup();
});

describe("간결한 데이터 화면", () => {
  it.each([
    ["normal", 3],
    ["two", 2],
    ["one", 1],
    ["empty", 0],
  ] as const)("%s 응답의 차량만 표시", async (scenario, count) => {
    setup(scenario);
    await render(<ResultScreen page="results" />);
    expect(screen.queryAllByTestId(/vehicle-card-/)).toHaveLength(count);
    expect(
      screen.getByLabelText("예시 데이터 · 실제 운행정보 아님"),
    ).toBeTruthy();
  });
  it("0%와 결측, 잘못된 분포를 구분", async () => {
    setup("zeroNull");
    const view = await render(<ResultScreen page="results" />);
    expect(
      within(screen.getByTestId("vehicle-card-1")).getAllByText("0%"),
    ).toHaveLength(3);
    expect(screen.getByText("예측 없음", { exact: true })).toBeTruthy();
    setup("partial");
    await view.rerender(<ResultScreen page="results" />);
    expect(
      within(screen.getByTestId("vehicle-card-2")).getByText("데이터 오류"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("vehicle-card-1")).getByText("92%"),
    ).toBeTruthy();
  });
  it("오래된 관측 시각은 짧게 유지", async () => {
    setup("stale");
    await render(<ResultScreen page="results" />);
    expect(screen.getByText("오래된 정보 · 07:10")).toBeTruthy();
  });
  it("빈 날짜에는 가상 기록을 만들지 않음", async () => {
    setup("noHistory");
    await render(<ResultScreen page="history" />);
    expect(screen.getByText("기록이 없어요.")).toBeTruthy();
    expect(screen.queryByText("07:10")).toBeNull();
  });
  it("관측 구간과 결측, 시간 필터", async () => {
    await render(<ResultScreen page="history" />);
    expect(screen.getAllByText("정보 없음")).toHaveLength(2);
    expect(screen.getAllByText("출발")).toHaveLength(2);
    await fireEvent.press(screen.getByText("오후", { exact: true }));
    expect(screen.getByText("기록이 없어요.")).toBeTruthy();
  });
  it("전망의 null을 0%로 그리지 않음", async () => {
    await render(<ResultScreen page="forecast" />);
    expect(screen.getByText("예측 없음", { exact: true })).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
  });
  it("직선거리 후보에 도보 시간을 생성하지 않음", async () => {
    setup("straight");
    await render(<ResultScreen page="alternatives" />);
    expect(screen.getByText("직선 420m · 도보 시간 미확인")).toBeTruthy();
    expect(screen.queryByText("경로 확인")).toBeNull();
  });
  it("유효하지 않은 선택은 재선택", async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({});
    await render(<ResultScreen page="results" />);
    expect(screen.getByText("정류장을 다시 선택해 주세요.")).toBeTruthy();
  });
  it("날짜 검증은 조회에만 적용", async () => {
    await render(<ResultScreen page="history" />);
    await fireEvent.changeText(
      screen.getByLabelText("조회 날짜 YYYY-MM-DD"),
      "2026-02-31",
    );
    await fireEvent.press(screen.getByText("조회", { exact: true }));
    expect(screen.getByText("날짜 형식을 확인해 주세요.")).toBeTruthy();
  });
});
describe("좌석 비교와 설명 분리", () => {
  it("설명은 기본 화면에 반복하지 않고 안내에서 확인", async () => {
    await render(
      <SeatProbabilityView
        vehicles={vehicles("normal")}
        stations={stations}
        selection={selection}
        onSelectStation={jest.fn()}
      />,
    );
    expect(screen.queryByText(/앞에서 기다리는 사람 수는/)).toBeNull();
    await fireEvent.press(screen.getByLabelText("확률 안내"));
    expect(screen.getByText(/앞에서 기다리는 사람 수는/)).toBeTruthy();
  });
  it("기준과 차량 상세, 동명 방문 순번 유지", async () => {
    const pick = jest.fn();
    await render(
      <SeatProbabilityView
        vehicles={vehicles("normal")}
        stations={stations}
        selection={selection}
        onSelectStation={pick}
      />,
    );
    await fireEvent.press(screen.getByLabelText("5석 이상 기준으로 보기"));
    expect(
      screen.getByLabelText("1번째 차량 도착 시 5석 이상 71%"),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("정류장별 비교 펼치기"));
    await fireEvent.press(
      screen.getByLabelText("예시 정류장 A 방문 3 내 정류장으로 설정"),
    );
    expect(pick).toHaveBeenCalledWith(stations[2]);
    await fireEvent.press(
      screen.getByLabelText("1번째 차량 정류장별 전망 보기"),
    );
    expect(screen.getByText("1번째 차량", { exact: true })).toBeTruthy();
    expect(screen.getAllByText("5분", { exact: true }).length).toBeGreaterThan(
      0,
    );
  });
});
describe("통일된 주요 화면", () => {
  it("노선 선택, 방향/노선 변경, 즐겨찾기", async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({});
    await render(<FlameApp />);
    await fireEvent.press(screen.getByLabelText("5100 노선 선택"));
    expect(screen.getByText("도착 시 좌석", { exact: true })).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("즐겨찾기 추가"));
    expect(jest.mocked(useBus)().toggle).toHaveBeenCalledWith(
      expect.objectContaining({
        routeId: "mock-route-5100",
        direction: "TO_SEOUL",
      }),
    );
    await fireEvent.press(screen.getByLabelText("노선 선택으로"));
    await fireEvent.press(screen.getByLabelText("1112 노선 선택"));
    expect(
      jest
        .mocked(useSection)
        .mock.calls.some(
          ([method, s]) =>
            method === "getPredictions" && s.routeId === "mock-route-1112",
        ),
    ).toBe(true);
    await fireEvent.press(screen.getByLabelText("더보기"));
    await fireEvent.press(screen.getByLabelText("국제캠퍼스 방면"));
    expect(jest.mocked(useStations)).toHaveBeenLastCalledWith(
      "mock-route-1112",
      "TO_CAMPUS",
    );
  });
  it("검색 결과와 동명 정류장은 순번으로 구별", async () => {
    await render(<Select />);
    await fireEvent.press(screen.getByLabelText("5100"));
    expect(screen.getAllByLabelText(/mock-station-01 방문 순번/)).toHaveLength(
      2,
    );
    await fireEvent.changeText(
      screen.getByLabelText("정류장 이름 검색"),
      "중앙",
    );
    expect(
      screen.queryAllByLabelText(/mock-station-01 방문 순번/),
    ).toHaveLength(0);
    await fireEvent.press(screen.getByLabelText("서울 방면"));
    expect(jest.mocked(useStations)).toHaveBeenLastCalledWith(
      "mock-route-5100",
      "TO_SEOUL",
    );
  });
  it("위치 거부 시에도 수동 검색 가능", async () => {
    setup("denied");
    await render(<Select />);
    expect(screen.getByText("위치 권한 없이 선택할 수 있어요.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("5100"));
    expect(screen.getByLabelText("정류장 이름 검색")).toBeTruthy();
  });
});

it("로딩·최초 오류·실패 후 캐시를 구분", async () => {
  const retry = jest.fn();
  jest.mocked(useSection).mockReturnValue({
    isPending: true,
    isFetching: true,
    error: null,
    refetch: retry,
  } as unknown as ReturnType<typeof useSection>);
  const result = await render(<ResultScreen page="results" />);
  expect(screen.getByLabelText("불러오는 중")).toBeTruthy();
  jest.mocked(useSection).mockReturnValue({
    isPending: false,
    isFetching: false,
    error: new Error("HTTP 503"),
    refetch: retry,
  } as unknown as ReturnType<typeof useSection>);
  await result.rerender(<ResultScreen page="results" />);
  await fireEvent.press(screen.getByText("다시 시도", { exact: true }));
  expect(retry).toHaveBeenCalled();
  setup();
  const original = jest.mocked(useSection).getMockImplementation()!;
  jest.mocked(useSection).mockImplementation(((
    ...args: Parameters<typeof useSection>
  ) => ({
    ...original(...args),
    error: new Error("HTTP 503"),
  })) as typeof useSection);
  await result.rerender(<ResultScreen page="results" />);
  expect(screen.getByText(/연결 실패 · 이전 정보/)).toBeTruthy();
  expect(screen.getAllByTestId(/vehicle-card-/)).toHaveLength(3);
});

it("정류장 변경에서 기존 노선과 방향을 유지", async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({
      ...selection,
      stationSequence: String(selection.stationSequence),
      direction: "TO_SEOUL",
    });
  await render(<Select />);
  expect(jest.mocked(useStations)).toHaveBeenLastCalledWith(
    "mock-route-5100",
    "TO_SEOUL",
  );
});
