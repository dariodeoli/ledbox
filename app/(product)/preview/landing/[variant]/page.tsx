import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingVariantPreview } from "@/components/product/LandingVariantPreview";
import { isProductLandingVariant, productLandingPreviewMetadata } from "@/lib/product-landing-previews";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PreviewPageProps = { params: Promise<{ variant: string }> };

export async function generateMetadata({ params }: PreviewPageProps): Promise<Metadata> {
  const { variant } = await params;
  if (!isProductLandingVariant(variant)) return { robots: { index: false, follow: false } };
  return productLandingPreviewMetadata(variant);
}

export default async function LandingPreviewPage({ params }: PreviewPageProps) {
  const { variant } = await params;
  if (!isProductLandingVariant(variant)) notFound();
  return <LandingVariantPreview variant={variant} />;
}
