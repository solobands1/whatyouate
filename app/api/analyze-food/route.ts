import { NextResponse } from "next/server";
import { FOOD_ANALYSIS_PROMPT, TEXT_ANALYSIS_PROMPT } from "../../../lib/ai/prompt";
import { coerceAnalysis, safeFallbackAnalysis } from "../../../lib/ai/schema";
import { supabaseServer } from "../../../lib/server/supabaseServer";

export const maxDuration = 60;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl";

const analyzeFoodRateMap = new Map<string, { count: number; resetAt: number }>();
function checkAnalyzeRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = analyzeFoodRateMap.get(key);
  if (!entry || now >= entry.resetAt) {
    analyzeFoodRateMap.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count += 1;
  return true;
}

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
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
        max_tokens: 700
      })
    });

    if (!response.ok) {
      throw new Error("OpenAI request failed");
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    return extractJson(content) ?? safeFallbackAnalysis();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function analyzeWithAnthropic(imageBase64: string, model: string, apiKey: string, hints?: string, packaging?: string) {
  const content: any[] = [
    { type: "text", text: "Analyze this food photo and respond with JSON only." }
  ];
  if (hints) {
    content.push({ type: "text", text: `Clarification: ${hints}.` });
  }
  content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64.split(",")[1] ?? "" } });
  if (packaging) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: packaging.split(",")[1] ?? "" } });
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        temperature: 0.2,
        system: FOOD_ANALYSIS_PROMPT,
        messages: [{ role: "user", content }]
      })
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "(unreadable)");
      console.error("[analyze-food] Anthropic error", response.status, errBody);
      throw new Error(`Anthropic request failed: ${response.status}`);
    }

    const data = await response.json();
    const responseText = data?.content?.[0]?.text ?? "";
    return extractJson(responseText) ?? safeFallbackAnalysis();
  } finally {
    clearTimeout(timeoutId);
  }
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
      confidence_overall_0_1: Math.max(analysis?.confidence_overall_0_1 ?? 0, analysis?.database_match_confidence_0_1 ?? 0),
      optional_quick_confirm_options: undefined
    },
    applied: true as const,
    values: { calories, protein, carbs: carbsVal, fat: fatVal }
  };
}

async function updateMealServer(mealId: string, analysis: any, userId?: string) {
  const ranges = analysis.estimated_ranges;
  const approxFromRange = (min: number, max: number) => Math.round((min + max) / 2);
  const roundCalories = (value: number) => {
    if (value <= 50) return Math.round(value / 5) * 5;
    return Math.round(value / 10) * 10;
  };
  const roundGram = (value: number) => Math.round(value);
  const calories =
    ranges.calories_min === ranges.calories_max
      ? ranges.calories_min
      : roundCalories(approxFromRange(ranges.calories_min, ranges.calories_max));
  const protein =
    ranges.protein_g_min === ranges.protein_g_max
      ? ranges.protein_g_min
      : roundGram(approxFromRange(ranges.protein_g_min, ranges.protein_g_max));
  const carbs =
    ranges.carbs_g_min === ranges.carbs_g_max
      ? ranges.carbs_g_min
      : roundGram(approxFromRange(ranges.carbs_g_min, ranges.carbs_g_max));
  const fat =
    ranges.fat_g_min === ranges.fat_g_max
      ? ranges.fat_g_min
      : roundGram(approxFromRange(ranges.fat_g_min, ranges.fat_g_max));
  const payload = {
    analysis_json: analysis,
    calories,
    protein,
    carbs,
    fat,
    status: "done"
  };
  let query = supabaseServer.from("meals").update(payload).eq("id", mealId);
  if (userId) query = query.eq("user_id", userId);
  const { error } = await query;
  if (error) {
    console.error("[updateMealServer] Supabase update failed:", JSON.stringify(error));
    throw error;
  }
  console.log("[updateMealServer] success mealId:", mealId, "calories:", calories, "status: done");
  if (process.env.DEBUG_MEALS === "1") {
    const { data: updatedRow, error: selectError } = await supabaseServer
      .from("meals")
      .select("calories, protein, carbs, fat, status")
      .eq("id", mealId)
      .maybeSingle();
    if (selectError) {
      console.error("[MEAL DB AFTER UPDATE] select error", selectError);
      return;
    }
    console.log("[MEAL DB AFTER UPDATE]", {
      mealId,
      calories: updatedRow?.calories,
      protein: updatedRow?.protein,
      carbs: updatedRow?.carbs,
      fat: updatedRow?.fat,
      status: updatedRow?.status
    });
  }
}

async function enrichWithOpenFoodFacts(mealId: string | undefined, analysis: any, userId?: string) {
  if (!mealId) {
    return;
  }

  const detectedBrand = analysis?.detected_brand;
  const detectedProduct = analysis?.detected_product;
  const analysisName = analysis?.name;
  if (!detectedBrand) {
    return;
  }

  try {
    const cleanQuery = (value: string) => value.replace(/\s+/g, " ").trim();
    const normalize = (value: string) => value.toLowerCase();
    const stripGenericWords = (value: string) => {
      const generic = ["shake", "chocolate", "meal"];
      const words = value
        .split(/\s+/)
        .filter((word) => word && !generic.includes(word.toLowerCase()));
      return cleanQuery(words.join(" "));
    };
    const queryCandidates = [
      { kind: "brand_product", value: cleanQuery(`${detectedBrand ?? ""} ${detectedProduct ?? ""}`) },
      { kind: "brand_name", value: cleanQuery(`${detectedBrand ?? ""} ${analysisName ?? ""}`) },
      { kind: "product_only", value: detectedProduct ? cleanQuery(detectedProduct) : "" },
      { kind: "name_only", value: analysisName ? cleanQuery(analysisName) : "" }
    ].filter((entry) => entry.value);

    const searchOnce = async (query: string) => {
      const searchController = new AbortController();
      const searchTimeoutId = setTimeout(() => searchController.abort(), 3_000);
      try {
        const offResponse = await fetch(
          `${OFF_SEARCH_URL}?search_terms=${encodeURIComponent(query)}&search_simple=1&json=1&action=process`,
          { signal: searchController.signal }
        );
        if (!offResponse.ok) throw new Error("OFF search failed");
        const offData = await offResponse.json();
        return offData?.products ?? [];
      } finally {
        clearTimeout(searchTimeoutId);
      }
    };

    let products: any[] = [];
    let best: any = null;
    const productForMatch = detectedProduct ?? analysisName ?? "";
    for (const entry of queryCandidates) {
      products = await searchOnce(entry.value);
      if (products.length === 0 && detectedProduct && entry.kind === "product_only") {
        const stripped = stripGenericWords(detectedProduct);
        if (stripped && stripped !== entry.value) {
          products = await searchOnce(stripped);
        }
      }
      if (products.length === 0) continue;
      best = pickBestProduct(products, detectedBrand, productForMatch);
      if (best) break;
    }

    if (!best) {
      const normalizedName = analysisName ? normalize(analysisName) : "";
      const normalizedBrand = detectedBrand ? normalize(detectedBrand) : "";
      const looksGeneric =
        normalizedName.includes("shake") ||
        normalizedName.includes("meal") ||
        normalizedName.includes("chocolate");
      const missingBrand = normalizedBrand && normalizedName && !normalizedName.includes(normalizedBrand);
      if (detectedBrand && (looksGeneric || missingBrand)) {
        const combined = cleanQuery(`${detectedBrand} ${detectedProduct || analysisName || ""}`);
        if (combined && combined !== analysisName) {
          const renamed = {
            ...analysis,
            name: combined
          };
          await updateMealServer(mealId, renamed);
        }
      }
      return;
    }

    const matchConfidence = computeMatchConfidence(best, detectedBrand, productForMatch);
    if (matchConfidence < 0.45) {
      return;
    }

    let enriched = {
      ...analysis,
      database_match_confidence_0_1: matchConfidence
    };

    const override = overrideRangesFromProduct(enriched, best);
    if (override.applied) {
      enriched = override.analysis;
    }
    const dbProductName = String(best?.product_name ?? "").trim();
    const dbBrand = best?.brands ? String(best.brands).split(",")[0].trim().replace(/\s+/g, " ") : "";
    if (dbProductName) {
      enriched = { ...enriched, name: dbProductName };
    } else if (dbBrand) {
      const detectedSuffix = detectedProduct ?? analysisName ?? "";
      enriched = { ...enriched, name: detectedSuffix ? `${dbBrand} ${detectedSuffix}`.trim() : dbBrand };
    }
    await updateMealServer(mealId, enriched, userId);
  } catch (err) {
    console.error("[OFF enrichment] error", err);
  }
}

async function analyzeTextOnly(textDescription: string, provider: string, openaiKey: string, anthropicKey: string) {
  const userPrompt = `Analyze this food description and provide nutritional estimates. Respond with JSON only: "${textDescription}"`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25_000);
  try {
    if (provider === "anthropic" && anthropicKey) {
      const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
      const response = await fetch(ANTHROPIC_URL, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model, max_tokens: 2048, temperature: 0.2,
          system: TEXT_ANALYSIS_PROMPT,
          messages: [{ role: "user", content: userPrompt }]
        })
      });
      if (!response.ok) throw new Error("Anthropic text analysis failed");
      const data = await response.json();
      return extractJson(data?.content?.[0]?.text ?? "") ?? safeFallbackAnalysis();
    } else if (openaiKey) {
      const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
      const response = await fetch(OPENAI_URL, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model, response_format: { type: "json_object" },
          messages: [
            { role: "system", content: TEXT_ANALYSIS_PROMPT },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.2, max_tokens: 1024
        })
      });
      if (!response.ok) throw new Error("OpenAI text analysis failed");
      const data = await response.json();
      return extractJson(data?.choices?.[0]?.message?.content ?? "") ?? safeFallbackAnalysis();
    }
    return safeFallbackAnalysis();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(req: Request) {
  try {
    const { imageBase64, imageBase64Secondary, hints, mealId, textDescription, userId, existingAnalysis } = await req.json();

    const rateLimitKey = userId ?? req.headers.get("x-forwarded-for") ?? "anon";
    if (!checkAnalyzeRateLimit(rateLimitKey)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // Enrichment-only path: skip Claude, just run OFF enrichment on an already-analyzed meal
    if (existingAnalysis && mealId && !imageBase64 && !textDescription) {
      const analysis = coerceAnalysis(existingAnalysis);
      await Promise.race([
        enrichWithOpenFoodFacts(mealId, analysis, userId),
        new Promise<void>((resolve) => setTimeout(resolve, 4000))
      ]);
      return NextResponse.json({ analysis });
    }

    if (textDescription && !imageBase64) {
      const provider = process.env.AI_PROVIDER ?? "openai";
      const rawAnalysis = await analyzeTextOnly(textDescription, provider, process.env.OPENAI_API_KEY ?? "", process.env.ANTHROPIC_API_KEY ?? "");
      const analysis = coerceAnalysis(rawAnalysis);
      if (mealId) await updateMealServer(mealId, analysis, userId);
      await Promise.race([
        enrichWithOpenFoodFacts(mealId, analysis, userId),
        new Promise<void>((resolve) => setTimeout(resolve, 4000))
      ]);
      return NextResponse.json({ analysis });
    }

    if (!imageBase64) {
      return NextResponse.json({ analysis: safeFallbackAnalysis() }, { status: 200 });
    }

    const provider = process.env.AI_PROVIDER ?? "openai";
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    let rawAnalysis: any = null;

    if (openaiKey) {
      const model = process.env.OPENAI_MODEL ?? "gpt-4o";
      rawAnalysis = await analyzeWithOpenAI(imageBase64, model, openaiKey, hints, imageBase64Secondary);
    } else if (provider === "anthropic" && anthropicKey) {
      const visionModel = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
      rawAnalysis = await analyzeWithAnthropic(imageBase64, visionModel, anthropicKey, hints, imageBase64Secondary);
    } else {
      rawAnalysis = safeFallbackAnalysis();
    }

    let analysis = coerceAnalysis(rawAnalysis);

    if (mealId) {
      await updateMealServer(mealId, analysis, userId);
    }

    await Promise.race([
      enrichWithOpenFoodFacts(mealId, analysis, userId),
      new Promise<void>((resolve) => setTimeout(resolve, 4000))
    ]);
    return NextResponse.json({ analysis });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[analyze-food] Unhandled error:", errMsg);
    return NextResponse.json({ error: "Analysis failed", detail: errMsg }, { status: 500 });
  }
}
