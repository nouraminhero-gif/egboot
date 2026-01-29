// queue.js
import Redis from "ioredis";

// ================== Redis Connection ==================
const REDIS_URL =
  process.env.REDIS_PUBLIC_URL ||
  process.env.REDIS_URL ||
  null;

if (!REDIS_URL) {
  console.error("❌ REDIS_URL not found in environment variables");
}

export const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      retryStrategy(times) {
        if (times > 3) return null; // prevent Railway restart loop
        return Math.min(times * 500, 2000);
      },
    })
  : null;

redis?.on("connect", () => console.log("✅ Redis connected"));
redis?.on("ready", () => console.log("✅ Redis ready"));
redis?.on("error", (err) => console.error("❌ Redis error:", err.message));

// ================== Queue Config ==================
const QUEUE_KEY = "egboot:incoming_messages";
let workerRunning = false;

// ================== SaaS / Tenant ==================
function getTenantId(job) {
  // SaaS: prefer env. If you later pass pageId from server.js => use it
  return process.env.TENANT_ID || job?.pageId || "default";
}

// ================== Sessions (Redis) ==================
const SESSION_TTL_SEC = Number(process.env.SESSION_TTL_SEC || 60 * 30); // 30 min

function sessionKey(tenantId, senderId) {
  return `sess:${tenantId}:${senderId}`;
}

async function getSession(tenantId, senderId) {
  if (!redis) return null;
  const raw = await redis.get(sessionKey(tenantId, senderId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setSession(tenantId, senderId, session) {
  if (!redis) return;
  const payload = JSON.stringify({
    ...session,
    updatedAt: Date.now(),
  });
  await redis.set(sessionKey(tenantId, senderId), payload, "EX", SESSION_TTL_SEC);
}

async function getOrCreateSession(tenantId, senderId) {
  let s = await getSession(tenantId, senderId);
  if (!s) {
    s = {
      tenantId,
      senderId,
      step: null,      // waiting_product | waiting_size | waiting_color | confirm
      data: {},        // { product, size, color }
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await setSession(tenantId, senderId, s);
  }
  return s;
}

async function clearSession(tenantId, senderId) {
  if (!redis) return;
  await redis.del(sessionKey(tenantId, senderId));
}

// ================== Dedup (Redis) ==================
async function isDuplicateEvent(tenantId, senderId, eventId, ttlSec = 60 * 10) {
  if (!redis) return false;
  if (!eventId) return false;

  const k = `dedup:${tenantId}:${senderId}:${eventId}`;
  const ok = await redis.set(k, "1", "NX", "EX", ttlSec);
  return ok !== "OK";
}

// ================== Enqueue ==================
export async function enqueueIncomingMessage(payload) {
  if (!redis) {
    console.warn("⚠️ enqueue skipped: redis not available");
    return;
  }
  try {
    await redis.rpush(QUEUE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error("❌ enqueue error:", err.message);
  }
}

// ================== Worker ==================
export async function startWorker({ pageAccessToken }) {
  if (!redis) {
    console.warn("⚠️ Worker not started: redis not available");
    return;
  }
  if (workerRunning) {
    console.log("ℹ️ Worker already running");
    return;
  }

  workerRunning = true;
  console.log("👷 Worker started");

  (async function loop() {
    while (true) {
      try {
        const data = await redis.blpop(QUEUE_KEY, 5);
        if (!data) continue;

        const [, raw] = data;
        const job = JSON.parse(raw);

        await handleMessage(job, pageAccessToken);
      } catch (err) {
        console.error("❌ Worker error:", err.message);
        await sleep(1000);
      }
    }
  })();
}

// ================== Message Handler ==================
async function handleMessage(job, pageAccessToken) {
  const event = job?.event;
  if (!event) return;

  const senderId = event?.sender?.id;
  if (!senderId) return;

  const tenantId = getTenantId(job);

  // Dedup: message mid (best), else postback mid, else ignore
  const mid = event?.message?.mid || event?.postback?.mid || null;
  if (mid && (await isDuplicateEvent(tenantId, senderId, mid))) {
    console.log("♻️ Duplicate skipped:", mid);
    return;
  }

  const session = await getOrCreateSession(tenantId, senderId);

  // ========= If you have sales.js ready, we try to call it safely =========
  // sales.js should export: export async function salesReply(ctx) { ... }
  // If missing/wrong export => fallback will run.
  if (event?.message?.text) {
    const text = String(event.message.text || "").trim();

    // reset
    if (/^(reset|ابدأ من جديد|ريست)$/i.test(text)) {
      await clearSession(tenantId, senderId);
      await sendTextMessage(senderId, "تمام ✅ رجّعنا من الأول. قول عايز تيشيرت ولا هودي؟", pageAccessToken);
      return;
    }

    // Try external sales.js
    try {
      const mod = await import("./sales.js");
      if (typeof mod.salesReply === "function") {
        const handled = await mod.salesReply({
          tenantId,
          senderId,
          text,
          event,
          session,
          setSession: (s) => setSession(tenantId, senderId, s),
          clearSession: () => clearSession(tenantId, senderId),
          sendText: (msg) => sendTextMessage(senderId, msg, pageAccessToken),
        });

        // لو sales.js رجّع true يعني اتعامل مع الرسالة خلاص
        if (handled === true) return;
      }
    } catch (e) {
      // ignore and fallback
      console.log("ℹ️ sales.js not ready / import failed -> fallback flow");
    }

    // ========= Fallback Simple Sales Flow (works الآن) =========
    await fallbackSalesFlow({ tenantId, senderId, text, session, pageAccessToken });
    return;
  }

  if (event?.postback) {
    console.log("📦 Postback:", event.postback.payload);
    // ممكن تعمل postback routing هنا بعدين
  }
}

// ================== Fallback Sales Flow ==================
async function fallbackSalesFlow({ tenantId, senderId, text, session, pageAccessToken }) {
  const t = normalize(text);

  // 1) Intent detect
  const wantsTshirt = t.includes("تيشيرت") || t.includes("tshirt") || t.includes("t-shirt");
  const wantsHoodie = t.includes("هودي") || t.includes("hoodie");

  if (!session.step) {
    if (wantsTshirt) {
      session.data.product = "tshirt";
      session.step = "waiting_size";
      await setSession(tenantId, senderId, session);

      await sendTextMessage(
        senderId,
        `📦 تيشيرت\n💰 السعر: 299 جنيه\n📏 المقاسات: M / L / XL\n🎨 الألوان: أسود / أبيض / كحلي\n\nابعت المقاس يا بطل 👌`,
        pageAccessToken
      );
      return;
    }

    if (wantsHoodie) {
      session.data.product = "hoodie";
      session.step = "waiting_size";
      await setSession(tenantId, senderId, session);

      await sendTextMessage(
        senderId,
        `📦 هودي\n💰 السعر: 599 جنيه\n📏 المقاسات: L / XL\n🎨 الألوان: أسود / رمادي\n\nابعت المقاس 👌`,
        pageAccessToken
      );
      return;
    }

    await sendTextMessage(senderId, "تمام ✅ قول تقصد: تيشيرت ولا هودي؟", pageAccessToken);
    session.step = "waiting_product";
    await setSession(tenantId, senderId, session);
    return;
  }

  // 2) Waiting product
  if (session.step === "waiting_product") {
    if (wantsTshirt) {
      session.data.product = "tshirt";
      session.step = "waiting_size";
      await setSession(tenantId, senderId, session);
      await sendTextMessage(senderId, "تمام ✅ ابعت المقاس (M / L / XL).", pageAccessToken);
      return;
    }
    if (wantsHoodie) {
      session.data.product = "hoodie";
      session.step = "waiting_size";
      await setSession(tenantId, senderId, session);
      await sendTextMessage(senderId, "تمام ✅ ابعت المقاس (L / XL).", pageAccessToken);
      return;
    }
    await sendTextMessage(senderId, "ممكن تحدد: تيشيرت ولا هودي؟", pageAccessToken);
    return;
  }

  // 3) Waiting size
  if (session.step === "waiting_size") {
    const size = extractSize(t);
    if (!size) {
      await sendTextMessage(senderId, "ابعت المقاس بشكل واضح: M أو L أو XL 🙏", pageAccessToken);
      return;
    }
    session.data.size = size;
    session.step = "waiting_color";
    await setSession(tenantId, senderId, session);
    await sendTextMessage(senderId, "تمام ✅ ابعت اللون (أسود/أبيض/كحلي/رمادي).", pageAccessToken);
    return;
  }

  // 4) Waiting color
  if (session.step === "waiting_color") {
    const color = extractColor(t);
    if (!color) {
      await sendTextMessage(senderId, "ابعت اللون: أسود / أبيض / كحلي / رمادي 🙏", pageAccessToken);
      return;
    }
    session.data.color = color;
    session.step = "confirm";
    await setSession(tenantId, senderId, session);

    await sendTextMessage(
      senderId,
      `✅ تأكيد الطلب:\n- المنتج: ${prettyProduct(session.data.product)}\n- المقاس: ${session.data.size}\n- اللون: ${prettyColor(session.data.color)}\n\nاكتب "تأكيد" عشان نكمل ✍️`,
      pageAccessToken
    );
    return;
  }

  // 5) Confirm
  if (session.step === "confirm") {
    if (t.includes("تأكيد") || t === "confirm") {
      await sendTextMessage(senderId, "تم ✅ (هنا هنكمل خطوة العنوان/الاسم/الموبايل بعدين)", pageAccessToken);
      // next step in real SaaS: collect shipping info
      session.step = "collect_phone";
      await setSession(tenantId, senderId, session);
      await sendTextMessage(senderId, "ابعت رقم الموبايل 📱", pageAccessToken);
      return;
    }
    await sendTextMessage(senderId, 'لو تمام اكتب "تأكيد" ✅ أو اكتب "reset" للبدء من جديد.', pageAccessToken);
    return;
  }

  // Example next
  if (session.step === "collect_phone") {
    session.data.phone = text.trim();
    session.step = "done";
    await setSession(tenantId, senderId, session);
    await sendTextMessage(senderId, "تمام ✅ استلمت رقمك. ابعت العنوان 🏠", pageAccessToken);
    return;
  }

  await sendTextMessage(senderId, "تمام ✅ قولّي تحب تيشيرت ولا هودي؟", pageAccessToken);
}

// ================== Send Message ==================
async function sendTextMessage(psid, text, token) {
  if (!token) {
    console.warn("⚠️ PAGE_ACCESS_TOKEN missing");
    return;
  }

  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: psid },
        message: { text },
      }),
    });

    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.error("❌ FB send failed:", r.status, body);
    }
  } catch (err) {
    console.error("❌ Send message error:", err.message);
  }
}

// ================== Utils ==================
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractSize(t) {
  // Arabic
  if (t.includes("ميديم") || t === "m" || t.includes(" m ")) return "M";
  if (t.includes("لارج") || t === "l" || t.includes(" l ")) return "L";
  if (t.includes("اكس لارج") || t.includes("xl") || t.includes(" x l ") || t === "xl") return "XL";

  // direct
  if (/\b(m|l|xl)\b/i.test(t)) return t.toUpperCase().match(/\b(M|L|XL)\b/)[0];
  return null;
}

function extractColor(t) {
  if (t.includes("اسود") || t.includes("أسود") || t.includes("black")) return "black";
  if (t.includes("ابيض") || t.includes("أبيض") || t.includes("white")) return "white";
  if (t.includes("كحلي") || t.includes("navy")) return "navy";
  if (t.includes("رمادي") || t.includes("gray") || t.includes("grey")) return "gray";
  return null;
}

function prettyProduct(p) {
  if (p === "tshirt") return "تيشيرت";
  if (p === "hoodie") return "هودي";
  return "منتج";
}

function prettyColor(c) {
  if (c === "black") return "أسود";
  if (c === "white") return "أبيض";
  if (c === "navy") return "كحلي";
  if (c === "gray") return "رمادي";
  return c;
}
