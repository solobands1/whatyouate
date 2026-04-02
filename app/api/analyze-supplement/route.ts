import { NextResponse } from "next/server";

export const maxDuration = 15;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const SUPPLEMENT_PROMPT = `You are a supplement database expert. Given a supplement name, return the standard single-serving dose and unit.

Return STRICT JSON ONLY matching this schema:
{
  "dose": number | null,
  "unit": "mg" | "mcg" | "IU" | "g" | "mL" | null,
  "canonical_name": "string"
}

Rules:
- dose: the standard single-serving amount as a number. null if unknown or not applicable.
- unit: the standard unit for that supplement. null if unknown.
- canonical_name: the clean, common name for the supplement (e.g. "Emergen-C" → "Vitamin C", "fish oil" → "Omega-3", "mag glycinate" → "Magnesium").
- Use the per-serving dose from the most common retail product, not the per-tablet/capsule if serving = multiple.
- For combination products (e.g. multivitamin), return dose: null and unit: null.
- For Vitamin D, always use IU as unit.
- For B12, always use mcg as unit.
- Return ONLY valid JSON. No commentary.`;

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

export async function POST(req: Request) {
  try {
    const { name, userId } = await req.json();
    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ dose: null, unit: null, canonical_name: name });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12_000);

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
          model: "claude-haiku-4-5-20251001",
          max_tokens: 256,
          temperature: 0,
          system: SUPPLEMENT_PROMPT,
          messages: [{ role: "user", content: `Supplement name: "${name}"` }]
        })
      });

      if (!response.ok) throw new Error("Anthropic request failed");
      const data = await response.json();
      const text = data?.content?.[0]?.text ?? "";
      const parsed = extractJson(text);
      if (!parsed) return NextResponse.json({ dose: null, unit: null, canonical_name: name });

      return NextResponse.json({
        dose: typeof parsed.dose === "number" ? parsed.dose : null,
        unit: typeof parsed.unit === "string" ? parsed.unit : null,
        canonical_name: typeof parsed.canonical_name === "string" ? parsed.canonical_name : name,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return NextResponse.json({ dose: null, unit: null, canonical_name: "" });
  }
}
