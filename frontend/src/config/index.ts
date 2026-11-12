export const config = {
  mode: process.env.EXPO_PUBLIC_DATA_MODE ?? "mock",
  baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  kakaoJavascriptKey: process.env.EXPO_PUBLIC_KAKAO_JAVASCRIPT_KEY ?? "",
  kakaoNativeKey: process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY ?? "",
};
