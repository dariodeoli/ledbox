import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { MobileClient } from "../api/client";
import type { Profile } from "../api/contract";
import { Body, Button, ErrorNotice, Field, Heading, Label } from "../ui/controls";
import { PrivacyLink } from "../ui/PrivacyLink";

export function ProfileScreen({ client }: { client: MobileClient }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true; setError(null); setProfile(null);
    client.profile().then(data => { if (current) setProfile(data); })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : "No se pudo cargar el perfil."); });
    return () => { current = false; };
  }, [client, retry]);
  async function logout() {
    setBusy(true); setError(null);
    try { await client.logout(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo revocar la sesión. Reintentá."); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError(null); setMessage(null);
    try { const result = await client.deleteAccount(password); setMessage(result.message); setDeleting(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo iniciar la eliminación."); }
    finally { setPassword(""); setBusy(false); }
  }
  return <View style={styles.stack}>
    <Heading>Mi perfil</Heading>
    {!profile && !error ? <ActivityIndicator accessibilityLabel="Cargando perfil" /> : null}
    {profile ? <>
      <Label>Nombre</Label><Body>{profile.name}</Body>
      <Label>Correo</Label><Body>{profile.email}</Body>
      <PrivacyLink url={profile.privacyUrl} />
      <Button label={busy ? "Procesando…" : "Cerrar sesión"} secondary disabled={busy} onPress={() => void logout()} />
      <Button label="Eliminar mi cuenta" secondary danger disabled={busy || !profile.deletionAvailable} onPress={() => { setDeleting(true); setError(null); }} />
      {!profile.deletionAvailable ? <Body>El backend no habilitó la eliminación para esta cuenta. Esta capacidad sigue pendiente de resolución.</Body> : null}
    </> : null}
    {deleting ? <View style={styles.stack}>
      <Heading>Eliminar mi cuenta</Heading>
      <Body>Esta acción elimina tu identidad, credenciales y membresías. Se conservan los registros empresariales, financieros, documentos firmados e historial de auditoría. Si sos el último propietario de una empresa, primero transferí ese rol.</Body>
      <Field label="Contraseña actual" secureTextEntry value={password} onChangeText={setPassword} autoCapitalize="none" autoCorrect={false} textContentType="password" editable={!busy} />
      <Button label="Confirmar eliminación" danger disabled={busy || !password} onPress={() => void remove()} />
      <Button label="Cancelar" secondary disabled={busy} onPress={() => { setDeleting(false); setPassword(""); }} />
    </View> : null}
    <ErrorNotice message={error} />
    {error && !profile ? <Button label="Reintentar perfil" onPress={() => setRetry(value => value + 1)} /> : null}
    {message ? <Body>{message}</Body> : null}
  </View>;
}
const styles = StyleSheet.create({ stack: { gap: 12 } });
