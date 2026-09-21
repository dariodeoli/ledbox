import type { Metadata } from "next";
import { LeadsModule } from "@/components/admin/modules/LeadsModule";

export const metadata: Metadata = { title: "Leads" };

export default function LeadsPage() {
  return <LeadsModule />;
}
