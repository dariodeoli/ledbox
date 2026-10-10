import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { MobileClient, MobileError } from "./src/api/client";
import { mobileContract, type Session } from "./src/api/contract";
import { secureSession } from "./src/api/secure-session";
import { Calendar } from "./src/screens/Calendar";
import { Companies } from "./src/screens/Companies";
import { EventScreen } from "./src/screens/Event";
import { Login } from "./src/screens/Login";
import { ProfileScreen } from "./src/screens/Profile";
import { Body, Button, ErrorNotice, usePalette } from "./src/ui/controls";
import { PrivacyLink } from "./src/ui/PrivacyLink";

function Shell() {
  const color = usePalette();
  const client = useMemo(() => new MobileClient(process.env.EXPO_PUBLIC_LEDBOX_API_URL ?? "", mobileContract, secureSession, fetch, false, process.env.EXPO_PUBLIC_LEDBOX_PRIVACY_URL ?? ""), []);
  const [session, setSession] = useState<Session | null>(null);
  const [screen, setScreen] = useState<"companies" | "calendar" | "profile">("companies");
  const [eventId, setEventId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    client.onExpired = () => { if (current) { setSession(null); setScreen("companies"); setEventId(null); setBootstrapError(null); } };
    setRestoring(true); setBootstrapError(null);
    client.restore().then(result => { if (current) { setSession(result); setScreen(result?.activeCompanyId ? "calendar" : "companies"); } })
      .catch(reason => { if (current) setBootstrapError(reason instanceof MobileError && reason.code === "UNAUTHENTICATED" ? null : reason instanceof Error ? reason.message : "No se pudo recuperar la sesión."); })
      .finally(() => { if (current) setRestoring(false); });
    return () => { current = false; client.onExpired = null; };
  }, [client, attempt]);
  function acceptSession(next: Session) {
    setEventId(null); setSession(next); setScreen(next.activeCompanyId ? "calendar" : "companies");
  }
  const company = session?.companies.find(item => item.id === session.activeCompanyId);
  return <SafeAreaView style={[styles.safe, { backgroundColor: color.bg }]}>
    <StatusBar style={color.bg === "#0a0a13" ? "light" : "dark"} />
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {mobileContract.status === "PENDING_PF" ? <Body>Integración móvil pendiente del contrato y endpoints PF. No hay conexión acreditada al backend.</Body> : null}
        {restoring ? <ActivityIndicator accessibilityLabel="Recuperando sesión" color={color.accent} /> : null}
        <ErrorNotice message={bootstrapError} />
        {bootstrapError ? <Button label="Reintentar sesión" onPress={() => setAttempt(value => value + 1)} /> : null}
        {bootstrapError ? <Button label="Cerrar sesión en el servidor" secondary onPress={() => { void client.logout().catch(reason => setBootstrapError(reason instanceof Error ? reason.message : "No se pudo cerrar sesión.")); }} /> : null}
        {!restoring && !bootstrapError && !session ? <Login client={client} onSession={acceptSession} /> : null}
        {!session ? <PrivacyLink url={process.env.EXPO_PUBLIC_LEDBOX_PRIVACY_URL ?? ""} /> : null}
        {!restoring && session ? <>
          <Body>{company?.name ?? "Elegí una empresa"} · {session.user.name}</Body>
          <View style={styles.navigation}>
            <Button label="Empresas" secondary selected={screen === "companies"} onPress={() => { setEventId(null); setScreen("companies"); }} />
            <Button label="Calendario" secondary disabled={!company} selected={screen === "calendar"} onPress={() => { setEventId(null); setScreen("calendar"); }} />
            <Button label="Perfil" secondary selected={screen === "profile"} onPress={() => { setEventId(null); setScreen("profile"); }} />
          </View>
          {screen === "companies" ? <Companies client={client} session={session} onChanging={() => { setEventId(null); setSession(previous => previous ? { ...previous, activeCompanyId: null } : null); }} onSession={acceptSession} /> : null}
          {screen === "calendar" && company ? eventId
            ? <EventScreen key={`${company.id}:${eventId}`} client={client} companyId={company.id} id={eventId} onBack={() => setEventId(null)} />
            : <Calendar key={company.id} client={client} companyId={company.id} onEvent={setEventId} /> : null}
          {screen === "profile" ? <ProfileScreen key={session.activeCompanyId} client={client} /> : null}
        </> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><Shell /></SafeAreaProvider>; }
const styles = StyleSheet.create({ safe: { flex: 1 }, content: { padding: 16, gap: 16 }, navigation: { gap: 8 } });
