import { useState } from "react";
import { Linking, View } from "react-native";
import { Button, ErrorNotice } from "./controls";

export function PrivacyLink({ url }: { url: string }) {
  const [error, setError] = useState<string | null>(null);
  async function open() {
    setError(null);
    try {
      const target = new URL(url);
      if (target.protocol !== "https:" || target.username || target.password) throw new Error("Configuración de privacidad pendiente: falta una URL HTTPS válida.");
      await Linking.openURL(target.toString());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo abrir la política de privacidad."); }
  }
  return <View><Button label="Política de privacidad" secondary onPress={() => void open()} /><ErrorNotice message={error} /></View>;
}
