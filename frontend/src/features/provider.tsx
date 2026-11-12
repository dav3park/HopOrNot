import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { Selection } from "../domain/types";
import { decodeFavorites, toggleFavorite } from "../domain/logic";
import { repository } from "../data/repository";
import { Scenario } from "../mocks/fixtures";
const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15000 } },
});
const STORAGE_KEY = "khu-bus-favorites-v1";
function useAppState() {
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [cacheScenario, setCacheScenario] = useState<Scenario>("normal");
  const [favorites, setFavorites] = useState<Selection[]>([]);
  const [storageError, setStorageError] = useState("");
  const [ready, setReady] = useState(false);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (active) setFavorites(decodeFavorites(raw));
      })
      .catch((e) => {
        if (active)
          setStorageError(
            e instanceof Error && e.message.includes("복구")
              ? e.message
              : "즐겨찾기 복원 실패 · 다시 추가해 주세요.",
          );
      })
      .finally(() => {
        if (active) setReady(true);
      });
    const sub = AppState.addEventListener("change", (state) =>
      focusManager.setFocused(state === "active"),
    );
    focusManager.setFocused(AppState.currentState === "active");
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  const repo = useMemo(() => repository(scenario), [scenario]);
  function toggle(s: Selection) {
    if (!ready) return;
    setFavorites((previous) => {
      const next = toggleFavorite(previous, s);
      writes.current = writes.current
        .then(() =>
          AsyncStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ version: 1, items: next }),
          ),
        )
        .catch(() =>
          setStorageError("즐겨찾기 저장 실패 · 다시 시도해 주세요."),
        );
      return next;
    });
  }
  async function chooseScenario(next: Scenario) {
    await client.cancelQueries();
    if (next === "corrupt") {
      // 실제 저장소를 훼손하지 않고 동일한 복원 검증 경로만 실행한다.
      try {
        decodeFavorites("{broken");
      } catch {
        setStorageError(
          "예시: 저장된 즐겨찾기를 복구하지 못했습니다. 앱은 계속 사용할 수 있습니다.",
        );
      }
    }
    if (next !== "httpError") setCacheScenario(next);
    setScenario(next);
  }
  useEffect(() => {
    void client.invalidateQueries();
  }, [scenario]);
  return {
    scenario,
    cacheScenario,
    chooseScenario,
    repo,
    favorites,
    toggle,
    ready,
    storageError,
  };
}
type AppContext = ReturnType<typeof useAppState>;
const Context = createContext<AppContext | null>(null);
function StateProvider({ children }: React.PropsWithChildren) {
  const state = useAppState();
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
export function Providers({ children }: React.PropsWithChildren) {
  return (
    <QueryClientProvider client={client}>
      <StateProvider>{children}</StateProvider>
    </QueryClientProvider>
  );
}
export function useBus() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("Provider missing");
  return ctx;
}
