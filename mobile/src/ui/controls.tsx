import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, useColorScheme, View, type TextInputProps } from "react-native";
import { tokens } from "./tokens";

export function usePalette() { return useColorScheme() === "light" ? tokens.light : tokens.dark; }
export function Label({ children }: { children: ReactNode }) {
  const color = usePalette();
  return <Text style={[styles.label, { color: color.muted }]}>{children}</Text>;
}
export function Heading({ children }: { children: ReactNode }) {
  const color = usePalette();
  return <Text accessibilityRole="header" style={[styles.heading, { color: color.text }]}>{children}</Text>;
}
export function Body({ children }: { children: ReactNode }) {
  const color = usePalette();
  return <Text style={[styles.body, { color: color.text }]}>{children}</Text>;
}
export function Button({ label, onPress, disabled, secondary, danger, selected }: { label: string; onPress(): void; disabled?: boolean; secondary?: boolean; danger?: boolean; selected?: boolean }) {
  const color = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, { borderColor: danger ? color.danger : color.accent, backgroundColor: secondary ? color.surface : danger ? color.danger : color.accent, opacity: disabled ? .5 : pressed ? .75 : 1 }]}>
    <Text style={[styles.buttonText, { color: secondary ? danger ? color.danger : color.accent : color.accentText }]}>{label}</Text>
  </Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const color = usePalette();
  return <View style={styles.field}>
    <Label>{label}</Label>
    <TextInput {...props} accessibilityLabel={label} placeholderTextColor={color.muted} style={[styles.input, { color: color.text, backgroundColor: color.surface, borderColor: color.line }, props.style]} />
  </View>;
}
export function ErrorNotice({ message }: { message: string | null }) {
  const color = usePalette();
  return message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, { color: color.danger }]}>{message}</Text> : null;
}
const styles = StyleSheet.create({
  heading: { fontSize: 24, fontWeight: "800", marginBottom: 12 },
  body: { fontSize: 14, lineHeight: 21 },
  label: { fontSize: 12, fontWeight: "600", marginBottom: 4 },
  button: { minHeight: 48, borderWidth: 1, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12, justifyContent: "center", alignItems: "center" },
  buttonText: { fontSize: 14, fontWeight: "700" },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, fontSize: 16 },
  field: { gap: 4, marginBottom: 12 },
  error: { fontSize: 14, lineHeight: 20, marginVertical: 12 },
});
