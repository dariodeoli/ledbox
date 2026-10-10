import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { MobileClient } from "../api/client";
import type { Session } from "../api/contract";
import { Body, Button, ErrorNotice, Heading } from "../ui/controls";

export function Companies({ client, session, onChanging, onSession }: { client: MobileClient; session: Session; onChanging(): void; onSession(session: Session): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function select(id: string) {
    setBusy(true); setError(null); onChanging();
    try { onSession(await client.switchCompany(id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo cambiar de empresa."); }
    finally { setBusy(false); }
  }
  return <View style={styles.stack}>
    <Heading>Mis empresas</Heading>
    {session.companies.length === 0 ? <Body>Tu cuenta no tiene membresías activas. Contactá al administrador.</Body> : null}
    {session.companies.map(company => <View style={styles.company} key={company.id}>
      <Body>{company.name} · {company.role}</Body>
      <Button label={company.id === session.activeCompanyId ? "Empresa activa" : `Usar ${company.name}`} secondary selected={company.id === session.activeCompanyId} disabled={busy || company.id === session.activeCompanyId} onPress={() => void select(company.id)} />
    </View>)}
    <ErrorNotice message={error} />
  </View>;
}
const styles = StyleSheet.create({ stack: { gap: 16 }, company: { gap: 8 } });
