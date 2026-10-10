import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { MobileClient } from "../api/client";
import type { Session } from "../api/contract";
import { Body, Button, ErrorNotice, Field, Heading } from "../ui/controls";

export function Login({ client, onSession }: { client: MobileClient; onSession(session: Session): void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try { const session = await client.login(email, password); setPassword(""); onSession(session); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo ingresar."); }
    finally { setPassword(""); setBusy(false); }
  }
  return <View style={styles.stack}>
    <Heading>EventOS</Heading>
    <Body>Ingresá con tu cuenta para consultar los eventos de tu empresa.</Body>
    <Field label="Correo" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="username" editable={!busy} />
    <Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" autoComplete="current-password" editable={!busy} onSubmitEditing={() => { if (email && password && !busy) void submit(); }} />
    <ErrorNotice message={error} />
    <Button label={busy ? "Ingresando…" : "Ingresar"} disabled={busy || !email.trim() || !password} onPress={() => void submit()} />
  </View>;
}
const styles = StyleSheet.create({ stack: { gap: 12, paddingVertical: 24 } });
