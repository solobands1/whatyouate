import { NextResponse } from "next/server";

const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product";

function toNum(value: any): number | null {
  if (value == null) return null;
  const n = Number(String(value).replace(",", ".").trim());
  return Number.isFinite(n) ? Math.round(n) : null;
}

function cleanBrand(product: any): string {
  return String(product?.brands ?? "").split(",")[0].trim().replace(/\s+/g, " ");
}

function normalizeName(product: any): string {
  return String(product?.product_name ?? "").trim() || cleanBrand(product) || "Food";
}

export async function POST(req: Request) {
  try {
    const { barcode } = await req.json();
    const code = String(barcode ?? "").trim().replace(/[^0-9A-Za-z]/g, "");
    if (!code) return NextResponse.json({ error: "Missing barcode" }, { status: 400 });

    const res = await fetch(`${OFF_PRODUCT_URL}/${encodeURIComponent(code)}.json`);
    if (!res.ok) return NextResponse.json({ error: "Lookup failed" }, { status: 502 });

    const data = await res.json();
    if (data?.status !== 1 || !data?.product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const n = data.product?.nutriments ?? {};
    const hasServing =
      toNum(n["energy-kcal_serving"] ?? n.energy_kcal_serving) !== null &&
      toNum(n.proteins_serving) !== null;
    const valuePer: "serving" | "100g" = hasServing ? "serving" : "100g";
    return NextResponse.json({
      name: normalizeName(data.product),
      brand: cleanBrand(data.product),
      valuePer,
      calories: hasServing
        ? toNum(n["energy-kcal_serving"] ?? n.energy_kcal_serving)
        : toNum(n["energy-kcal_100g"] ?? n.energy_kcal_100g),
      protein: hasServing ? toNum(n.proteins_serving) : toNum(n.proteins_100g),
      carbs: hasServing ? toNum(n.carbohydrates_serving) : toNum(n.carbohydrates_100g),
      fat: hasServing ? toNum(n.fat_serving) : toNum(n.fat_100g),
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
