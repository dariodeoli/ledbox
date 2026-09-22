import { WhatsappIcon } from "@/components/whatsapp/WhatsappIcon";
import { whatsappUrl } from "@/lib/public-config";

/** Botón flotante de WhatsApp: misma pieza en la landing y en las fichas. */
export function PublicWhatsappFloat({ message = "Hola LedBox! Quiero más información." }: { message?: string }) {
  return (
    <a
      href={whatsappUrl(message)}
      target="_blank"
      rel="noopener noreferrer"
      className="wa-float"
      aria-label="Abrir WhatsApp"
    >
      <WhatsappIcon size={28} />
    </a>
  );
}
