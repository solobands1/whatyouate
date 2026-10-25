// Discord message cards ("embeds") for the app's webhooks: a coloured bar, a title, spaced-out lines
// and fields, so reports are easy to scan. Discord allows 10 cards and about 6000 characters per
// message, so long reports are split across several messages.

export type Embed = {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
};

export const COLORS = {
  blue: 0x3f7fd6,
  green: 0x2e9e6a,
  amber: 0xe0a100,
  red: 0xd64545,
  grey: 0x8a94a6,
};

const DESC_MAX = 3900;

/** One card per section; very long sections continue in a second card with the same title. */
export function section(title: string, lines: string[], opts: Omit<Embed, "title" | "description"> = {}): Embed[] {
  const cards: Embed[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    cards.push({ ...opts, title: cards.length ? `${title} (cont.)` : title, description: buf.join("\n") });
    buf = [];
  };
  for (const line of lines) {
    if ([...buf, line].join("\n").length > DESC_MAX) flush();
    buf.push(line);
  }
  flush();
  if (!cards.length) cards.push({ ...opts, title });
  return cards;
}

const size = (e: Embed) =>
  (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) +
  (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);

/** Splits cards into messages that fit Discord's limits (10 cards, about 6000 characters). */
export function batches(embeds: Embed[]): Embed[][] {
  const out: Embed[][] = [];
  let cur: Embed[] = [];
  let chars = 0;
  for (const e of embeds) {
    const n = size(e);
    if (cur.length && (cur.length === 10 || chars + n > 5800)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(e);
    chars += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Sends cards to a webhook, optionally with a CSV file on the first message. Returns the last response. */
export async function sendEmbeds(url: string, embeds: Embed[], opts: { content?: string; file?: { name: string; text: string } } = {}) {
  let res: Response | undefined;
  const groups = batches(embeds);
  for (let i = 0; i < groups.length; i++) {
    const payload = { content: i === 0 ? opts.content : undefined, embeds: groups[i], allowed_mentions: { parse: [] } };
    if (i === 0 && opts.file) {
      const form = new FormData();
      form.append("payload_json", JSON.stringify(payload));
      form.append("files[0]", new Blob([opts.file.text], { type: "text/csv" }), opts.file.name);
      res = await fetch(url, { method: "POST", body: form });
    } else {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
  }
  return res;
}
