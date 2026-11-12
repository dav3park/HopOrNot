import { beforeEach, expect, it, jest } from "@jest/globals";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Providers, useBus } from "../src/features/provider";
import { Button } from "../src/components/ui";
import { Selection } from "../src/domain/types";
jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual(
    "@react-native-async-storage/async-storage/jest/async-storage-mock",
  ),
);
const selection: Selection = {
  routeId: "mock-route-5100",
  direction: "TO_CAMPUS",
  stationId: "mock-station-01",
  stationSequence: 1,
};
function Harness() {
  const { ready, favorites, toggle, storageError } = useBus();
  return (
    <>
      <Text>{ready ? `저장 ${favorites.length}개` : "복원 중"}</Text>
      <Text>{storageError}</Text>
      <Button
        title="즐겨찾기 전환"
        disabled={!ready}
        onPress={() => toggle(selection)}
      />
    </>
  );
}
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});
it("실제 Provider에서 저장 → unmount → 다시 mount 복원 → 삭제 저장", async () => {
  const first = await render(
    <Providers>
      <Harness />
    </Providers>,
  );
  await screen.findByText("저장 0개");
  await fireEvent.press(screen.getByText("즐겨찾기 전환"));
  await screen.findByText("저장 1개");
  await waitFor(() =>
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "khu-bus-favorites-v1",
      JSON.stringify({ version: 1, items: [selection] }),
    ),
  );
  await first.unmount();
  await render(
    <Providers>
      <Harness />
    </Providers>,
  );
  await screen.findByText("저장 1개");
  await fireEvent.press(screen.getByText("즐겨찾기 전환"));
  await screen.findByText("저장 0개");
  await waitFor(() =>
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
      "khu-bus-favorites-v1",
      JSON.stringify({ version: 1, items: [] }),
    ),
  );
});
it("손상 저장소에서도 초기화 안내 후 새 즐겨찾기 저장 가능", async () => {
  await AsyncStorage.setItem("khu-bus-favorites-v1", "{broken");
  await render(
    <Providers>
      <Harness />
    </Providers>,
  );
  await screen.findByText("저장 0개");
  expect(screen.getByText(/즐겨찾기를 복구하지 못했습니다/)).toBeTruthy();
  await fireEvent.press(screen.getByText("즐겨찾기 전환"));
  await screen.findByText("저장 1개");
});
