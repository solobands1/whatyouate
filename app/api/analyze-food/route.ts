import { NextResponse } from "next/server";
import { FOOD_ANALYSIS_PROMPT } from "../../../lib/ai/prompt";
import { coerceAnalysis, safeFallbackAnalysis } from "../../../lib/ai/schema";
import { supabase } from "../../../lib/supabaseClient";
import { updateMeal } from "../../../lib/supabaseDb";

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

  const strongMatches = products.filter((item) => {
    const b = String(item.brands ?? "").toLowerCase();
    const p = String(item.product_name ?? "").toLowerCase();
    if (!b.includes(brandLower)) return false;
    const matchCount = productWords.filter((word) => p.includes(word)).length;
    return matchCount >= 2 || matchCount / productWords.length >= 0.6;
  });

  if (strongMatches.length === 0) return null;

  const scoreProduct = (item: any) => {
    let score = 0;
    if (item?.serving_quantity != null) score += 6;
    if (item?.quantity) score += 4;
    const detectedName = product.toLowerCase();
    const detectedWords = detectedName
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3);
    const productName = String(item?.product_name ?? "").toLowerCase();
    const matchCount = detectedWords.filter((word) => productName.includes(word)).length;
    const coverage = detectedWords.length ? matchCount / detectedWords.length : 0;
    score += matchCount * 5;
    score += coverage * 15;
    const servingQuantity =
      item?.serving_quantity != null ? Number(item.serving_quantity) : null;
    const quantityText = String(item?.quantity ?? "");
    const quantityMatch = quantityText.match(/([\d.]+)\s*g/i);
    const servingSize = String(item?.serving_size ?? "");
    const servingMatch = servingSize.match(/([\d.]+)\s*g/i);
    const servingGrams =
      servingQuantity != null && Number.isFinite(servingQuantity)
        ? servingQuantity
        : quantityMatch
          ? Number(quantityMatch[1])
          : servingMatch
            ? Number(servingMatch[1])
            : null;
    const nutriments = item?.nutriments ?? {};
    if (
      nutriments["energy-kcal_serving"] != null ||
      nutriments.energy_kcal_serving != null
    ) {
      score += 10;
    }
    score += Object.keys(nutriments).length;
    return score;
  };

  return strongMatches.reduce((best, item) => {
    return scoreProduct(item) > scoreProduct(best) ? item : best;
  }, strongMatches[0]);
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
    nutriments["energy-kcal_value"] ??
    nutriments["energy-kcal-value"] ??
    nutriments.energy_kcal_100g ??
    nutriments.energy_kcal ??
    nutriments.energy_kcal_value ??
    nutriments["energy-kcal-value"];
  const proteins100g =
    nutriments.proteins_100g ??
    nutriments.proteins ??
    nutriments.proteins_value ??
    nutriments["proteins-value"];
  const carbs100g =
    nutriments.carbohydrates_100g ??
    nutriments.carbohydrates ??
    nutriments.carbohydrates_value ??
    nutriments["carbohydrates-value"];
  const fat100g =
    nutriments.fat_100g ??
    nutriments.fat ??
    nutriments.fat_value ??
    nutriments["fat-value"];

  const servingQuantity =
    product?.serving_quantity != null ? Number(product.serving_quantity) : null;
  const quantityText = String(product?.quantity ?? "");
  const quantityMatch = quantityText.match(/([\d.]+)\s*g/i);
  const servingSize = String(product?.serving_size ?? "");
  const servingMatch = servingSize.match(/([\d.]+)\s*g/i);
  let servingGrams =
    servingQuantity != null && Number.isFinite(servingQuantity)
      ? servingQuantity
      : quantityMatch
        ? Number(quantityMatch[1])
        : servingMatch
          ? Number(servingMatch[1])
          : null;

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
    return { analysis, applied: false as const, values: null as null };
  }

  if (!hasServingValues && servingGrams == null) {
    servingGrams = 100;
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
    return { analysis, applied: false as const, values: null as null };
  }

  const calories = Number(kcal);
  const protein = Number(proteins);
  const carbsVal = Number(carbs);
  const fatVal = Number(fat);

  console.log("[OFF override macros]", {
    calories,
    protein,
    carbs: carbsVal,
    fat: fatVal,
    servingGrams
  });

  return {
    analysis: {
      ...analysis,
      estimated_ranges: {
        calories_min: calories,
        calories_max: calories,
        protein_g_min: protein,
        protein_g_max: protein,
        carbs_g_min: carbsVal,
        carbs_g_max: carbsVal,
        fat_g_min: fatVal,
        fat_g_max: fatVal
      },
      confidence_overall_0_1: Math.max(analysis?.confidence_overall_0_1 ?? 0, 0.9),
      optional_quick_confirm_options: undefined
    },
    applied: true as const,
    values: { calories, protein, carbs: carbsVal, fat: fatVal }
  };
}

async function enrichWithOpenFoodFacts(mealId: string | undefined, analysis: any) {
  if (!mealId) {
    console.log("[OFF enrichment] skipped");
    return;
  }

  console.log("[OFF enrichment] started", mealId);

  const { data: mealRow } = await supabase
    .from("meals")
    .select("status")
    .eq("id", mealId)
    .maybeSingle();
  const detectedBrand = analysis?.detected_brand;
  const detectedProduct = analysis?.detected_product;
  const analysisName = analysis?.name;
  if (!detectedBrand) {
    console.log("[OFF enrichment] skipped");
    return;
  }

  try {
    const primarySearch =
      analysis?.name ||
      `${analysis?.detected_brand ?? ""} ${analysis?.detected_product ?? ""}`.trim();

    if (!primarySearch) {
      console.log("[OFF enrichment] skipped");
      return;
    }
    console.log("[OFF enrichment] search", primarySearch);

    const offResponse = await fetch(
      `${OFF_SEARCH_URL}?search_terms=${encodeURIComponent(primarySearch)}&search_simple=1&json=1`
    );
    if (offResponse.ok) {
      const offData = await offResponse.json();
      console.log("[OFF enrichment] products", offData?.products?.length ?? 0);
      const productForMatch = detectedProduct ?? analysisName ?? "";
      let best = pickBestProduct(offData?.products ?? [], detectedBrand, productForMatch);
      console.log("[OFF enrichment] best", Boolean(best));
      if (!best && detectedBrand && detectedProduct && analysisName) {
        const retryResponse = await fetch(
          `${OFF_SEARCH_URL}?search_terms=${encodeURIComponent(analysisName)}&search_simple=1&json=1`
        );
        if (retryResponse.ok) {
          const retryData = await retryResponse.json();
          best = pickBestProduct(retryData?.products ?? [], detectedBrand, productForMatch);
        }
      }
      if (best) {
        const matchConfidence = computeMatchConfidence(best, detectedBrand, productForMatch);
        let enriched = {
          ...analysis,
          database_match_confidence_0_1: matchConfidence
        };
        function normalizeBrand(s: string) {
          return s.toLowerCase().replace(/[^a-z0-9]/g, "");
        }

        const brandMatch =
          detectedBrand &&
          best?.brands &&
          normalizeBrand(best.brands).includes(
            normalizeBrand(detectedBrand)
          );

        if (matchConfidence >= 0.45) {
          const override = overrideRangesFromProduct(enriched, best);
          enriched = override.analysis;
          if (best?.brands) {
            const cleanBrand =
              best.brands
                .split(",")[0]
                .trim()
                .replace(/\s+/g, " ");

            enriched = {
              ...enriched,
              name: cleanBrand
            };
          }
          if (override.applied) {
            console.log("[OFF enrichment] matched", enriched.name);
            await updateMeal(mealId, enriched);
          } else {
            console.log("[OFF enrichment] skipped");
          }
        } else {
          console.log("[OFF enrichment] skipped");
        }
      } else {
        console.log("[OFF enrichment] skipped");
      }
    } else {
      console.log("[OFF enrichment] skipped");
    }
  } catch {
    console.log("[OFF enrichment] skipped");
  }
}

export async function POST(req: Request) {
  try {
    console.time("request_total");
    console.time("image_processing");
    const { imageBase64, imageBase64Secondary, hints, mealId } = await req.json();
    if (!imageBase64) {
      console.timeEnd("image_processing");
      console.timeEnd("request_total");
      return NextResponse.json({ analysis: safeFallbackAnalysis() }, { status: 200 });
    }
    console.timeEnd("image_processing");

    const provider = process.env.AI_PROVIDER ?? "openai";
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    let rawAnalysis: any = null;

    console.time("ai_inference");
    if (provider === "anthropic" && anthropicKey) {
      const model = process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20240620";
      rawAnalysis = await analyzeWithAnthropic(imageBase64, model, anthropicKey, hints, imageBase64Secondary);
    } else if (openaiKey) {
      const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
      rawAnalysis = await analyzeWithOpenAI(imageBase64, model, openaiKey, hints, imageBase64Secondary);
    } else {
      rawAnalysis = safeFallbackAnalysis();
    }
    console.timeEnd("ai_inference");

    console.log("[AI detected_brand]", rawAnalysis?.detected_brand);
    console.time("response_formatting");
    let analysis = coerceAnalysis(rawAnalysis);

    console.timeEnd("response_formatting");
    console.timeEnd("request_total");
    setTimeout(() => {
      enrichWithOpenFoodFacts(mealId, analysis);
    }, 0);
    return NextResponse.json({ analysis });
  } catch {
    console.timeEnd("request_total");
    return NextResponse.json({ analysis: safeFallbackAnalysis() }, { status: 200 });
  }
}
