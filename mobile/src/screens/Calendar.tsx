import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { CalendarResult, MobileClient } from "../api/client";
import { dayKey, dateTime, eventsForDay, monthRange, shiftMonth } from "../calendar";
import { Body, Button, ErrorNotice, Heading, Label, usePalette } from "../ui/controls";

export function Calendar({ client, companyId, onEvent }: { client: MobileClient; companyId: string; onEvent(id: string): void }) {
  const today = dayKey(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [result, setResult] = useState<CalendarResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const color = usePalette();
  const range = monthRange(month);
  useEffect(() => {
    let current = true;
    setResult(null); setBusy(true); setError(null);
    const requested = monthRange(month);
    client.calendar(requested.from, requested.to).then(data => { if (current) setResult(data); })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : "No se pudo cargar el calendario."); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [client, companyId, month, retry]);
  function move(delta: number) {
    const next = shiftMonth(month, delta);
    setResult(null); setMonth(next); setSelected(`${next}-01`);
  }
  const events = result?.events ?? [];
  return <View style={styles.stack}>
    <Heading>Calendario de eventos</Heading>
    <View style={styles.monthControls}>
      <Button label="Mes anterior" secondary onPress={() => move(-1)} />
      <Body>{new Intl.DateTimeFormat("es-PY", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`))}</Body>
      <Button label="Mes siguiente" secondary onPress={() => move(1)} />
    </View>
    <Label>Fechas y horas de Paraguay · {result?.timeZone ?? "America/Asuncion"}</Label>
    <View style={styles.grid}>
      {["L", "M", "M", "J", "V", "S", "D"].map((day, index) => <Text key={`weekday-${index}`} style={[styles.weekday, { color: color.muted }]}>{day}</Text>)}
      {Array.from({ length: range.offset }, (_, index) => <View key={`empty-${index}`} style={styles.day} />)}
      {Array.from({ length: range.count }, (_, index) => {
        const key = `${month}-${String(index + 1).padStart(2, "0")}`;
        const count = result ? eventsForDay(events, key).length : null;
        return <Pressable key={key} onPress={() => setSelected(key)} accessibilityRole="button" accessibilityLabel={`${key}${count === null ? "" : `, ${count} eventos`}`} accessibilityState={{ selected: key === selected }}
          style={[styles.day, { backgroundColor: key === selected ? color.accent : color.surface, borderColor: color.line }]}>
          <Text style={{ color: key === selected ? color.accentText : color.text, fontWeight: "700" }}>{index + 1}</Text>
          {count ? <Text style={{ color: key === selected ? color.accentText : color.accent, fontSize: 10 }}>{count}</Text> : null}
        </Pressable>;
      })}
    </View>
    {busy ? <ActivityIndicator accessibilityLabel="Cargando eventos" color={color.accent} /> : null}
    <ErrorNotice message={error} />
    {error ? <Button label="Reintentar calendario" secondary onPress={() => setRetry(value => value + 1)} /> : null}
    {result?.truncated ? <Body>El servidor limitó los resultados. Esta lista puede estar incompleta.</Body> : null}
    <Heading>{selected}</Heading>
    {result && eventsForDay(events, selected).length === 0 ? <Body>No hay eventos para este día.</Body> : null}
    {eventsForDay(events, selected).map(event => <Pressable key={event.id} accessibilityRole="button" accessibilityLabel={`Abrir ${event.name}`} onPress={() => onEvent(event.eventId)} style={[styles.event, { borderColor: color.line }]}>
      <Body>{event.name}</Body>
      <Label>{dateTime(event.startsAt)} · {event.statusLabel}</Label>
      {event.clientName ? <Label>{event.clientName}</Label> : null}
      {event.location ? <Label>{event.location}</Label> : null}
    </Pressable>)}
  </View>;
}
const styles = StyleSheet.create({
  stack: { gap: 12 }, monthControls: { gap: 8, alignItems: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap" }, weekday: { width: "14.2857%", textAlign: "center", paddingVertical: 8 },
  day: { width: "14.2857%", minHeight: 48, alignItems: "center", justifyContent: "center", borderWidth: .5 },
  event: { paddingVertical: 12, borderBottomWidth: 1, gap: 4 },
});
