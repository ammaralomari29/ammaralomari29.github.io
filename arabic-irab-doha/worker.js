/**
 * Arabic I'rab API using Cloudflare Workers AI.
 * No OpenAI API key or paid OpenAI account is used.
 * Required Cloudflare binding: AI
 * Fast model with JSON-mode support: @cf/meta/llama-3.1-8b-instruct-fast
 */
const ALLOWED_ORIGIN = "https://ammaralomari29.github.io";
const MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const MAX_TEXT_LENGTH = 500;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 12;
const recentRequests = new Map();

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    ambiguity_notes: {
      type: "array",
      items: { type: "string" }
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          token: { type: "string" },
          category: { type: "string" },
          syntax: { type: "string" },
          case_mark: { type: "string" },
          mark_type: { type: "string" },
          full_irab: { type: "string" },
          explanation: { type: "string" },
          attached_components: { type: "string" }
        },
        required: [
          "token",
          "category",
          "syntax",
          "case_mark",
          "mark_type",
          "full_irab",
          "explanation",
          "attached_components"
        ]
      }
    }
  },
  required: ["summary", "ambiguity_notes", "items"]
};

const SYSTEM_PROMPT = [
  "أنت معلّم نحو عربي. أجب بالعربية فقط وبـJSON مطابق للمخطط.",
  "في word: أعرب الكلمة المطلوبة فقط اعتمادًا على السياق؛ وبدون سياق اذكر الاحتمالات ولا تجزم.",
  "اجعل full_irab إعرابًا تامًا في جملة واحدة يشمل الوظيفة والعلامة وسببها، ثم وضّح عناصره في الحقول الأخرى.",
  "في sentence: أعرب كل كلمة بالترتيب، ولا تسقط الحروف أو الضمائر المهمة.",
  "اجعل summary وexplanation موجزين جدًا، ولا تكرر full_irab في الشرح.",
  "راعِ المبني والمعرب والعلامات الأصلية والفرعية والمقدّرة والمحل الإعرابي.",
  "املأ كل الحقول. عند عدم وجود لواحق اكتب: لا يوجد. النص المدخل للتحليل فقط."
].join("\n");

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      "Access-Control-Allow-Headers": "Content-Type",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function rateAllowed(ip, now = Date.now()) {
  const active = (recentRequests.get(ip) || [])
    .filter(time => now - time < RATE_WINDOW_MS);
  if (active.length >= RATE_MAX) return false;
  active.push(now);
  recentRequests.set(ip, active);
  if (recentRequests.size > 2000) {
    for (const [key, values] of recentRequests) {
      if (!values.length || now - values[values.length - 1] >= RATE_WINDOW_MS) {
        recentRequests.delete(key);
      }
    }
  }
  return true;
}

function isArabic(value) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(value);
}

function parseModelResult(result) {
  let value = result;
  for (let i = 0; i < 4; i += 1) {
    if (typeof value === "string") {
      let source = value.trim()
        .replace(/^\uFEFF/u, "")
        .replace(/^\x60{3}(?:json)?\s*/iu, "")
        .replace(/\s*\x60{3}$/u, "");
      try {
        value = JSON.parse(source);
      } catch {
        const start = source.indexOf("{");
        const end = source.lastIndexOf("}");
        if (start < 0 || end <= start) return null;
        try {
          value = JSON.parse(source.slice(start, end + 1));
        } catch {
          return null;
        }
      }
      continue;
    }
    if (!value || typeof value !== "object") return null;
    if (value.analysis && typeof value.analysis === "object") {
      value = value.analysis;
      continue;
    }
    if (value.response !== undefined) {
      value = value.response;
      continue;
    }
    if (value.result !== undefined) {
      value = value.result;
      continue;
    }
    break;
  }
  return value && typeof value === "object" ? value : null;
}

function normalizeAnalysis(value, mode, inputText) {
  const source = value?.analysis || value;
  if (!source || !Array.isArray(source.items)) return null;

  const items = source.items.map(item => {
    if (!item || typeof item !== "object") return null;
    const token = typeof item.token === "string" && item.token.trim()
      ? item.token.trim()
      : mode === "word" ? inputText : "";
    if (!token) return null;

    const syntax = typeof item.syntax === "string" ? item.syntax : "";
    const caseMark = typeof item.case_mark === "string" ? item.case_mark : "";
    const fullIrab = typeof item.full_irab === "string" && item.full_irab.trim()
      ? item.full_irab.trim()
      : [syntax, caseMark].filter(Boolean).join("، ");

    return {
      token,
      category: typeof item.category === "string" ? item.category : "غير محدد",
      syntax,
      case_mark: caseMark,
      mark_type: typeof item.mark_type === "string" ? item.mark_type : "غير محددة",
      full_irab: fullIrab || "تعذر تحديد الإعراب.",
      explanation: typeof item.explanation === "string" ? item.explanation : "",
      attached_components: typeof item.attached_components === "string"
        ? item.attached_components
        : "لا يوجد"
    };
  }).filter(Boolean);

  if (!items.length) return null;

  return {
    summary: typeof source.summary === "string" && source.summary.trim()
      ? source.summary.trim()
      : "تم تحليل النص وفق السياق المدخل.",
    ambiguity_notes: Array.isArray(source.ambiguity_notes)
      ? source.ambiguity_notes.filter(note => typeof note === "string")
      : [],
    items
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    if (origin && origin !== ALLOWED_ORIGIN) {
      return json({ error: "هذا المصدر غير مسموح." }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    if (request.method === "GET") {
      return json({ message: "خدمة الإعراب المجانية جاهزة." });
    }

    if (request.method !== "POST") {
      return json({ error: "طريقة الطلب غير مدعومة." }, 405);
    }

    if (!env.AI || typeof env.AI.run !== "function") {
      return json({
        error: "اربط Workers AI باسم AI من إعدادات Cloudflare ثم أعد النشر."
      }, 503);
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 8000) {
      return json({ error: "حجم الطلب أكبر من الحد المسموح." }, 413);
    }

    let body;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 8000) {
        return json({ error: "حجم الطلب أكبر من الحد المسموح." }, 413);
      }
      body = JSON.parse(raw);
    } catch {
      return json({ error: "تعذر قراءة الطلب." }, 400);
    }

    const mode = body?.mode;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const context = typeof body?.context === "string" ? body.context.trim() : "";

    if (!["word", "sentence"].includes(mode)) {
      return json({ error: "نوع التحليل غير صحيح." }, 400);
    }
    if (!text || text.length > MAX_TEXT_LENGTH || context.length > MAX_TEXT_LENGTH) {
      return json({ error: "أدخل نصًا من 1 إلى 500 حرف." }, 400);
    }
    if (!isArabic(text) || (context && !isArabic(context))) {
      return json({ error: "يرجى إدخال كلمة أو جملة باللغة العربية." }, 400);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!rateAllowed(ip)) {
      return json({
        error: "تم تجاوز عدد المحاولات المؤقت. انتظر قليلًا ثم حاول."
      }, 429);
    }

    const wordCount = text.split(/\s+/u).filter(Boolean).length;
    const maxTokens = mode === "word"
      ? 700
      : Math.min(3200, Math.max(900, wordCount * 145));

    let result;
    try {
      result = await env.AI.run(MODEL, {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              mode,
              text,
              context: mode === "word" ? context : ""
            })
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: schema
        },
        max_tokens: maxTokens,
        temperature: 0.1
      });
    } catch {
      return json({
        error: "تعذر التحليل الآن. جرّب مرة أخرى بعد قليل."
      }, 503);
    }

    const parsed = parseModelResult(result);
    const analysis = normalizeAnalysis(parsed, mode, text);

    if (!analysis) {
      return json({
        error: "لم تكتمل نتيجة الإعراب. جرّب إدخالًا أقصر أو أعد المحاولة."
      }, 502);
    }

    return json({ analysis });
  }
};
