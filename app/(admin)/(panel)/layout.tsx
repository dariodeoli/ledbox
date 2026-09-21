import { AdminOfflineProvider } from "@/components/admin/AdminOffline";
import { AdminShell } from "@/components/admin/AdminShell";

export default function AdminPanelLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AdminOfflineProvider>
      <AdminShell>{children}</AdminShell>
    </AdminOfflineProvider>
  );
}
