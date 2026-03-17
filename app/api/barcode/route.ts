import { NextResponse } from "next/server";

const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product";

const barcodeRateMap = new Map<string, { count: number; resetAt: number }>();
function checkBarcodeRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = barcodeRateMap.get(key);
  if (!entry || now >= entry.resetAt) {
    barcodeRateMap.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count += 1;
  return true;
}

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

function parseServingGrams(servingSize: string): number | null {
  if (!servingSize) return null;
  // Prefer the value inside parentheses: "1 bar (45 g)" → 45
  const inParens = servingSize.match(/\((\d+(?:\.\d+)?)\s*(?:g|ml)\)/i);
  if (inParens) return Math.round(Number(inParens[1]));
  // Fall back to first bare "Xg" or "X ml" pattern: "30g", "28 g"
  const bare = servingSize.match(/(\d+(?:\.\d+)?)\s*(?:g|ml)/i);
  if (bare) return Math.round(Number(bare[1]));
  return null;
}

export async function POST(req: Request) {
  try {
    const rateLimitKey = req.headers.get("x-forwarded-for") ?? "anon";
    if (!checkBarcodeRateLimit(rateLimitKey)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

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

    if (hasServing) {
      return NextResponse.json({
        name: normalizeName(data.product),
        brand: cleanBrand(data.product),
        valuePer: "serving",
        calories: toNum(n["energy-kcal_serving"] ?? n.energy_kcal_serving),
        protein: toNum(n.proteins_serving),
        carbs: toNum(n.carbohydrates_serving),
        fat: toNum(n.fat_serving),
      });
    }

    // No _serving nutriments — try to derive from serving_size string + 100g values
    const servingSize = String(data.product?.serving_size ?? "").trim();
    const servingGrams = parseServingGrams(servingSize);
    if (servingGrams != null && servingGrams > 0) {
      const scale = (v: number | null) => (v != null ? Math.round((v * servingGrams) / 100) : null);
      return NextResponse.json({
        name: normalizeName(data.product),
        brand: cleanBrand(data.product),
        valuePer: "serving",
        calories: scale(toNum(n["energy-kcal_100g"] ?? n.energy_kcal_100g)),
        protein: scale(toNum(n.proteins_100g)),
        carbs: scale(toNum(n.carbohydrates_100g)),
        fat: scale(toNum(n.fat_100g)),
      });
    }

    // True fallback: only 100g data available — user will be prompted for grams
    return NextResponse.json({
      name: normalizeName(data.product),
      brand: cleanBrand(data.product),
      valuePer: "100g",
      calories: toNum(n["energy-kcal_100g"] ?? n.energy_kcal_100g),
      protein: toNum(n.proteins_100g),
      carbs: toNum(n.carbohydrates_100g),
      fat: toNum(n.fat_100g),
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
