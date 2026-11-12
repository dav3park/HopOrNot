import { Redirect, useLocalSearchParams } from "expo-router";
export default function SelectEntry() {
  const params = useLocalSearchParams();
  return (
    <Redirect
      href={{ pathname: "/", params: { ...params, screen: "select" } }}
    />
  );
}
