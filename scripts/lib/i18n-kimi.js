/**
 * Kimi (Moonshot) translation client. OpenAI-compatible chat completions.
 * All endpoints/models come from env; the API key is read from a mounted file.
 */

export function extractProtected(text) {
  // Fenced code, inline code, URLs, shortcodes ({netease ...}, :::cloud ...),
  // and HTML tags must survive translation unchanged — counted, not compared
  // by position (the model may legitimately reflow whitespace).
  const fences = (text.match(/^```[\s\S]*?^```/gm) || []).length;
  const inlineCode = (text.match(/`[^`\n]+`/g) || []).length;
  const urls = (text.match(/https?:\/\/[^\s)\]]+/g) || []).length;
  const shortcodes = (text.match(/\{[a-zA-Z][^}\n]*\}|^:::[a-zA-Z][^\n]*/gm) || []).length;
  const htmlTags = (text.match(/<\/?[a-zA-Z][^>\n]*>/g) || []).length;
  return { fences, inlineCode, urls, shortcodes, htmlTags };
}

export function protectedCountsMatch(source, translated) {
  const a = extractProtected(source);
  const b = extractProtected(translated);
  return Object.keys(a).every((k) => a[k] === b[k]);
}

const SYSTEM_PROMPT = `You are a professional technical translator translating a Chinese blog post into English.
Rules:
- Output strict JSON: {"title": "...", "summary": "...", "body": "..."}
- "summary": 1-2 English sentences describing the post (max 60 words).
- Translate body faithfully; preserve all Markdown structure exactly.
- NEVER translate or alter: fenced code blocks, inline code, URLs, file paths,
  shell commands and their arguments, HTML tags, and shortcode tokens like
  {netease id=...} or :::cloud ... — copy them byte-for-byte.
- Song names, artist names, and brand names stay in original form.
- Use the supplied glossary exactly when a listed term appears.`;

export async function translateWithKimi({ baseUrl, apiKey, model, glossaryText, title, body, timeoutMs = 120_000 }) {
  const user = JSON.stringify({
    glossary: glossaryText || '',
    title,
    body,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw new Error(`kimi http ${res.status}: ${text}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('kimi empty response');
    }
    const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (typeof parsed.title !== 'string' || typeof parsed.body !== 'string' || !parsed.body.trim()) {
      throw new Error('kimi malformed json');
    }
    const translated = {
      title: parsed.title.trim(),
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      body: parsed.body,
    };
    if (!translated.title) throw new Error('kimi empty title');
    if (!protectedCountsMatch(body, translated.body)) {
      throw new Error('protected-token mismatch');
    }
    return translated;
  } finally {
    clearTimeout(timer);
  }
}
