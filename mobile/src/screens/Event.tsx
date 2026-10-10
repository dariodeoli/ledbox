import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { MobileClient } from "../api/client";
import type { EventDetail } from "../api/contract";
import { dateTime } from "../calendar";
import { Body, Button, ErrorNotice, Heading, Label } from "../ui/controls";

export function EventScreen({ client, companyId, id, onBack }: { client: MobileClient; companyId: string; id: string; onBack(): void }) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true; setEvent(null); setError(null);
    client.event(id).then(result => { if (current) setEvent(result.event); })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : "No se pudo cargar el evento."); });
    return () => { current = false; };
  }, [client, companyId, id, retry]);
  return <View style={styles.stack}>
    <Button label="Volver al calendario" secondary onPress={onBack} />
    {!event && !error ? <ActivityIndicator accessibilityLabel="Cargando evento" /> : null}
    <ErrorNotice message={error} />
    {error ? <Button label="Reintentar detalle" onPress={() => setRetry(value => value + 1)} /> : null}
    {event ? <>
      <Heading>{event.name}</Heading><Body>{event.statusLabel}</Body>
      <Label>Inicio</Label><Body>{dateTime(event.startsAt)}</Body>
      <Label>Fin</Label><Body>{dateTime(event.endsAt)}</Body>
      <Label>Montaje</Label><Body>{dateTime(event.setupAt)}</Body>
      <Label>Desmontaje</Label><Body>{dateTime(event.strikeAt)}</Body>
      <Label>Lugar</Label><Body>{event.location ?? "Sin lugar informado"}</Body>
      {event.address ? <Body>{event.address}</Body> : null}
      <Body>El contrato móvil v1 ofrece este resumen. No expone contactos, notas privadas ni documentos.</Body>
      {event.notes ? <><Label>Notas</Label><Body>{event.notes}</Body></> : null}
    </> : null}
  </View>;
}
const styles = StyleSheet.create({ stack: { gap: 8 } });
