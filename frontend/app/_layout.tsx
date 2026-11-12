import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Providers } from "../src/features/provider";
export default function Layout() {
  return (
    <SafeAreaProvider>
      <Providers>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerTitle: "",
            headerBackTitle: "뒤로",
            headerShadowVisible: false,
            headerTintColor: "#000000",
            headerStyle: { backgroundColor: "#FFFFFF" },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="tools" options={{ title: "HopOrNot" }} />
          <Stack.Screen name="map" options={{ headerShown: false }} />
          <Stack.Screen
            name="select"
            options={{ title: "노선 · 정류장 선택" }}
          />
          <Stack.Screen name="manual" options={{ title: "정류장 검색" }} />
          <Stack.Screen name="results" options={{ title: "HopOrNot" }} />
        </Stack>
      </Providers>
    </SafeAreaProvider>
  );
}
