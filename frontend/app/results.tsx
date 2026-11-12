import { Redirect, useLocalSearchParams } from "expo-router";
import { ResultScreen } from "../src/features/result-screen";
export default function ResultsEntry() {
  const { details, ...params } = useLocalSearchParams();
  if (details === "1") return <ResultScreen page="results" />;
  return <Redirect href={{ pathname: "/", params }} />;
}
