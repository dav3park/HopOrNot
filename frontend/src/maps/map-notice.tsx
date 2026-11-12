import { Text, View } from "react-native";
export function MapNotice({ message }: { message: string }) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 260,
        backgroundColor: "#DEEDF2",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <Text
        style={{
          fontSize: 15,
          lineHeight: 23,
          textAlign: "center",
          color: "#000000",
        }}
      >
        {message}
      </Text>
    </View>
  );
}
