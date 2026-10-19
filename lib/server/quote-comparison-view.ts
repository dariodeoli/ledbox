import { db } from "./db";
import { findPublicComparison } from "./quote-comparison";
import { portalBudgetView, portalInclude } from "./budget-portal";
import { normalizeBudgetCode } from "../public-config";
import { buildPortalCompany } from "../portal-company";

export async function loadPublicComparison(token: string) {
  const code = normalizeBudgetCode(token);
  if (!code) return null;
  const group = await findPublicComparison(code);
  if (!group) return null;
  const organization = await db.organization.findUnique({
    where: { id: group.organizationId },
    select: { name: true, appearance: true, rentalSettings: { select: { storefrontAccent: true } } },
  });
  if (!organization) return null;
  const company = buildPortalCompany({
    name: organization.name,
    profile: null,
    appearance: organization.appearance,
    accent: organization.rentalSettings?.storefrontAccent,
  });
  const alternatives = await Promise.all(group.budgets.map(async (member) => {
    const row = await db.budget.findUniqueOrThrow({ where: { id: member.id }, include: portalInclude });
    const view = portalBudgetView(row);
    const resourcePath = `/api/portal/comparison/${encodeURIComponent(code)}/resources/${encodeURIComponent(row.id)}`;
    return {
      id: row.id, label: row.comparisonLabel!, title: view.title, reference: view.reference,
      subtotal: view.subtotal, discount: view.discount, total: view.total,
      validUntil: view.validUntil, deliveryAt: view.deliveryAt, ivaType: view.ivaType,
      warranty: view.warranty, notes: view.notes, paymentTerms: view.paymentPlan.terms,
      advanceAmount: view.paymentPlan.advanceAmount, installments: view.paymentPlan.installments,
      items: view.items.map((item) => {
        const source = row.items.find((i) => i.id === item.id)?.inventory;
        return { ...item, imageUrl: !source || source.organizationId !== group.organizationId ? null : item.imageUrl || (source.imageMime ? `${resourcePath}/image/${encodeURIComponent(item.id)}` : null) };
      }),
      attachments: view.attachments ?? [], referenceLinks: view.referenceLinks ?? [], resourcePath,
    };
  }));
  // Allowlist only: no payment account, technical evidence, costs or internal actors.
  // Only the public company identity is sent to the comparison page; profile,
  // payment details, costs, and internal actors remain outside this DTO.
  return {
    title: group.title,
    expiresAt: group.expiresAt.toISOString(),
    selectedBudgetId: group.selectedBudgetId,
    company: { name: company.name, brand: company.brand, fontHref: company.fontHref, fontFamily: company.fontFamily },
    alternatives,
  };
}
export type PublicQuoteComparison = NonNullable<Awaited<ReturnType<typeof loadPublicComparison>>>;
