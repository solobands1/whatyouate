import { NextResponse } from "next/server";
import { FOOD_ANALYSIS_PROMPT } from "../../../lib/ai/prompt";
import { coerceAnalysis, safeFallbackAnalysis } from "../../../lib/ai/schema";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl";

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  const snippet = text.slice(start, end + 1);
  try {
    return JSON.parse(snippet);
  } catch {
    return null;
  }
}

async function analyzeWithOpenAI(imageBase64: string, model: string, apiKey: string, hints?: string, packaging?: string) {
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: FOOD_ANALYSIS_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this food photo and respond with JSON only." },
            ...(hints ? [{ type: "text", text: `Clarification: ${hints}.` }] : []),
            { type: "image_url", image_url: { url: imageBase64 } },
            ...(packaging ? [{ type: "image_url", image_url: { url: packaging } }] : [])
          ]
        }
      ],
      temperature: 0.2,
      max_tokens: 260
    })
  });

  if (!response.ok) {
    throw new Error("OpenAI request failed");
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  return extractJson(content) ?? safeFallbackAnalysis();
}

async function analyzeWithAnthropic(imageBase64: string, model: string, apiKey: string, hints?: string, packaging?: string) {
  const content: any[] = [
    { type: "text", text: FOOD_ANALYSIS_PROMPT },
    { type: "text", text: "Analyze this food photo and respond with JSON only." }
  ];
  if (hints) {
    content.push({ type: "text", text: `Clarification: ${hints}.` });
  }
  content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64.split(",")[1] ?? "" } });
  if (packaging) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: packaging.split(",")[1] ?? "" } });
  }
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error("Anthropic request failed");
  }

  const data = await response.json();
  const responseText = data?.content?.[0]?.text ?? "";
  return extractJson(responseText) ?? safeFallbackAnalysis();
}

function pickBestProduct(products: any[], brand: string, product: string) {
  if (!products?.length) return null;
  const brandLower = brand.toLowerCase();
  const productWords = product
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3);

  if (productWords.length === 0) return null;

  const strongMatch = products.find((item) => {
    const b = String(item.brands ?? "").toLowerCase();
    const p = String(item.product_name ?? "").toLowerCase();
    if (!b.includes(brandLower)) return false;
    const matchCount = productWords.filter((word) => p.includes(word)).length;
    return matchCount >= 2 || matchCount / productWords.length >= 0.6;
  });

  return strongMatch ?? null;
}

function computeMatchConfidence(product: any, detectedBrand: string, detectedProduct: string) {
  const brandLower = detectedBrand.toLowerCase();
  const productWords = detectedProduct
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3);
  const brandMatch = String(product?.brands ?? "").toLowerCase().includes(brandLower) ? 1 : 0;
  const name = String(product?.product_name ?? "").toLowerCase();
  const matchCount = productWords.length
    ? productWords.filter((word) => name.includes(word)).length
    : 0;
  const overlapRatio = productWords.length ? matchCount / productWords.length : 0;
  const nutriments = product?.nutriments ?? {};
  const kcalServing = nutriments["energy-kcal_serving"] ?? nutriments.energy_kcal_serving;
  const proteinsServing = nutriments.proteins_serving;
  const carbsServing = nutriments.carbohydrates_serving;
  const fatServing = nutriments.fat_serving;
  const hasServingValues = [kcalServing, proteinsServing, carbsServing, fatServing].every(
    (v) => v !== undefined && v !== null
  );
  const servingScore = hasServingValues ? 1 : 0;
  const score = brandMatch * 0.4 + overlapRatio * 0.4 + servingScore * 0.2;
  return Math.max(0, Math.min(1, score));
}

function overrideRangesFromProduct(analysis: any, product: any) {
  const nutriments = product?.nutriments ?? {};
  const kcalServing = nutriments["energy-kcal_serving"] ?? nutriments.energy_kcal_serving;
  const proteinsServing = nutriments.proteins_serving;
  const carbsServing = nutriments.carbohydrates_serving;
  const fatServing = nutriments.fat_serving;

  const servingValues = [kcalServing, proteinsServing, carbsServing, fatServing];
  const hasServingValues = servingValues.every((v) => v !== undefined && v !== null);

  const kcal100g =
    nutriments["energy-kcal_100g"] ??
    nutriments["energy-kcal"] ??
    nutriments.energy_kcal_100g ??
    nutriments.energy_kcal;
  const proteins100g = nutriments.proteins_100g ?? nutriments.proteins;
  const carbs100g = nutriments.carbohydrates_100g ?? nutriments.carbohydrates;
  const fat100g = nutriments.fat_100g ?? nutriments.fat;

  const servingSize = String(product?.serving_size ?? "");
  const servingMatch = servingSize.match(/([\d.]+)\s*g/i);
  const servingGrams = servingMatch ? Number(servingMatch[1]) : null;

  const categoriesText = [
    String(product?.categories ?? ""),
    Array.isArray(product?.categories_tags) ? product.categories_tags.join(" ") : ""
  ]
    .join(" ")
    .toLowerCase();
  const isBeverage = ["beverages", "drinks", "meal-replacement", "shakes", "liquid"].some((term) =>
    categoriesText.includes(term)
  );
  if (isBeverage && (servingGrams == null || servingGrams < 200 || servingGrams > 500)) {
    return analysis;
  }

  if (!hasServingValues && servingGrams == null) {
    return analysis;
  }

  const kcal = hasServingValues
    ? kcalServing
    : (kcal100g != null ? (Number(kcal100g) * servingGrams!) / 100 : undefined);
  const proteins = hasServingValues
    ? proteinsServing
    : (proteins100g != null ? (Number(proteins100g) * servingGrams!) / 100 : undefined);
  const carbs = hasServingValues
    ? carbsServing
    : (carbs100g != null ? (Number(carbs100g) * servingGrams!) / 100 : undefined);
  const fat = hasServingValues
    ? fatServing
    : (fat100g != null ? (Number(fat100g) * servingGrams!) / 100 : undefined);

  if ([kcal, proteins, carbs, fat].some((v) => v === undefined || v === null || Number.isNaN(Number(v)))) {
    return analysis;
  }

  const tighten = (value: number) => {
    const v = Number(value);
    const min = Math.max(0, Math.round(v * 0.9));
    const max = Math.max(min, Math.round(v * 1.1));
    return { min, max };
  };

  const cals = tighten(kcal);
  const prot = tighten(proteins);
  const carb = tighten(carbs);
  const fats = tighten(fat);

  return {
    ...analysis,
    estimated_ranges: {
      calories_min: cals.min,
      calories_max: cals.max,
      protein_g_min: prot.min,
      protein_g_max: prot.max,
      carbs_g_min: carb.min,
      carbs_g_max: carb.max,
      fat_g_min: fats.min,
      fat_g_max: fats.max
    },
    confidence_overall_0_1: 0.9,
    optional_quick_confirm_options: undefined
  };
}

export async function POST(req: Request) {
  try {
    const { imageBase64, imageBase64Secondary, hints } = await req.json();
    if (!imageBase64) {
      return NextResponse.json({ analysis: safeFallbackAnalysis() }, { status: 200 });
    }

    const provider = process.env.AI_PROVIDER ?? "openai";
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    let rawAnalysis: any = null;

    if (provider === "anthropic" && anthropicKey) {
      const model = process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20240620";
      rawAnalysis = await analyzeWithAnthropic(imageBase64, model, anthropicKey, hints, imageBase64Secondary);
    } else if (openaiKey) {
      const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
      rawAnalysis = await analyzeWithOpenAI(imageBase64, model, openaiKey, hints, imageBase64Secondary);
    } else {
      rawAnalysis = safeFallbackAnalysis();
    }

    console.log("[AI detected_brand]", rawAnalysis?.detected_brand);
    let analysis = coerceAnalysis(rawAnalysis);

    const detectedBrand = rawAnalysis?.detected_brand;
    const detectedProduct = rawAnalysis?.detected_product;

    if (detectedBrand && detectedProduct) {
      try {
        const searchTerms = encodeURIComponent(`${detectedBrand} ${detectedProduct}`);
        const offResponse = await fetch(
          `${OFF_SEARCH_URL}?search_terms=${searchTerms}&search_simple=1&json=1`
        );
        if (offResponse.ok) {
          const offData = await offResponse.json();
          const best = pickBestProduct(offData?.products ?? [], detectedBrand, detectedProduct);
          if (best) {
            if (process.env.NODE_ENV !== "production") {
              const nutriments = best?.nutriments ?? {};
              const kcalServing = nutriments["energy-kcal_serving"] ?? nutriments.energy_kcal_serving;
              const proteinsServing = nutriments.proteins_serving;
              const carbsServing = nutriments.carbohydrates_serving;
              const fatServing = nutriments.fat_serving;
              const hasServingValues = [kcalServing, proteinsServing, carbsServing, fatServing].every(
                (v) => v !== undefined && v !== null
              );
              const servingSize = String(best?.serving_size ?? "");
              const servingMatch = servingSize.match(/([\d.]+)\s*g/i);
              const servingGrams = servingMatch ? Number(servingMatch[1]) : null;
              const skipReason = !hasServingValues && servingGrams == null ? "missing_serving_size" : null;

              console.log("[OFF] brand:", detectedBrand);
              console.log("[OFF] product:", detectedProduct);
              console.log("[OFF] usedServingValues:", hasServingValues);
              console.log("[OFF] servingGrams:", servingGrams);
              console.log("[OFF] skipReason:", skipReason);
            }
            const matchConfidence = computeMatchConfidence(best, detectedBrand, detectedProduct);
            analysis = {
              ...analysis,
              database_match_confidence_0_1: matchConfidence
            };
            if (matchConfidence >= 0.85) {
              analysis = overrideRangesFromProduct(analysis, best);
            } else {
              analysis = {
                ...analysis,
                precision_mode_available: true
              };
            }
          }
        }
      } catch {
        // Ignore OFF errors and keep AI estimates.
      }
    }

    return NextResponse.json({ analysis });
  } catch {
    return NextResponse.json({ analysis: safeFallbackAnalysis() }, { status: 200 });
  }
}
