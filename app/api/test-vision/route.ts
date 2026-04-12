import { NextResponse } from "next/server";

export const maxDuration = 30;

// 1x1 white JPEG
const TINY_JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVIP/2Q==";

export async function GET() {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const anthropicModel = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
  const openaiKey = process.env.OPENAI_API_KEY;

  const results: Record<string, any> = {
    anthropicKeyPresent: !!anthropicKey,
    anthropicKeyPrefix: anthropicKey ? anthropicKey.slice(0, 20) + "..." : null,
    anthropicModel,
    openaiKeyPresent: !!openaiKey,
    openaiKeyPrefix: openaiKey ? openaiKey.slice(0, 20) + "..." : null,
    provider: process.env.AI_PROVIDER ?? "openai",
  };

  // Test Anthropic vision
  if (anthropicKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: anthropicModel,
          max_tokens: 64,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: TINY_JPEG } },
              { type: "text", text: "Reply with just the word OK." }
            ]
          }]
        })
      });
      clearTimeout(timeout);
      const body = await res.json();
      results.anthropicStatus = res.status;
      results.anthropicResponse = res.ok ? (body?.content?.[0]?.text ?? body) : body;
    } catch (e: any) {
      results.anthropicError = e?.message ?? String(e);
    }
  }

  // Test OpenAI vision
  if (openaiKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          max_tokens: 64,
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${TINY_JPEG}` } },
              { type: "text", text: "Reply with just the word OK." }
            ]
          }]
        })
      });
      clearTimeout(timeout);
      const body = await res.json();
      results.openaiStatus = res.status;
      results.openaiResponse = res.ok ? (body?.choices?.[0]?.message?.content ?? body) : body;
    } catch (e: any) {
      results.openaiError = e?.message ?? String(e);
    }
  }

  return NextResponse.json(results);
}
