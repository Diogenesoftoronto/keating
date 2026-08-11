import { Alert, Linking } from "react-native";

export async function openProductLink(label: string, url: string): Promise<void> {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error("No application can open this link.");
    await Linking.openURL(url);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "The link could not be opened.";
    Alert.alert(`Could not open ${label}`, `${detail}\n\nOpen this address in a browser:\n${url}`);
  }
}
