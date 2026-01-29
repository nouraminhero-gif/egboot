// src/sessions/sessionManager.js
import crypto from "crypto";
import { redis } from "../queue.js";

/**
 * Session keys:
 *  sess:{tenantId}:{senderId}  -> JSON session
 */

const DEFAULT_TTL_SEC = Number(process.env.SESSION_TTL_SEC || 60 * 30); // 30 min

function key(tenantId, senderId) {
  return `sess:${tenantId}:${senderId}`;
}

export function makeTenantId(reqOrBody = null) {
  // SaaS-ready:
  // - لو عندك أكتر من صفحة/عميل: حط TENANT_ID في env لكل خدمة
  // - أو استخرجه من pageId في body.entry[0].id (لو شغّال Pages متعددة)
  return process.env.TENANT_ID || "default";
}

export function newTraceId() {
  return crypto.randomBytes(8).toString("hex");
}

export async function getSession(tenantId, senderId) {
  if (!redis) return null;

  const raw = await redis.get(key(tenantId, senderId));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setSession(tenantId, senderId, session, ttlSec = DEFAULT_TTL_SEC) {
  if (!redis) return;

  const payload = JSON.stringify({
    ...session,
    updatedAt: Date.now(),
  });

  // set + ttl
  await redis.set(key(tenantId, senderId), payload, "EX", ttlSec);
}

export async function clearSession(tenantId, senderId) {
  if (!redis) return;
  await redis.del(key(tenantId, senderId));
}

export async function touchSession(tenantId, senderId, ttlSec = DEFAULT_TTL_SEC) {
  if (!redis) return;
  await redis.expire(key(tenantId, senderId), ttlSec);
}

/**
 * Ensure a base session exists.
 */
export async function getOrCreateSession(tenantId, senderId) {
  let s = await getSession(tenantId, senderId);

  if (!s) {
    s = {
      tenantId,
      senderId,
      // intent/state machine fields
      intent: null,
      step: null, // e.g. "waiting_product" | "waiting_size" | "waiting_color"
      data: {},
      traceId: newTraceId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await setSession(tenantId, senderId, s);
  }

  return s;
}

/**
 * Dedup: prevents processing the same FB message twice.
 * Use mid (message.id) if available.
 */
export async function isDuplicateEvent(tenantId, senderId, eventId, ttlSec = 60 * 10) {
  if (!redis) return false;
  if (!eventId) return false;

  const dedupKey = `dedup:${tenantId}:${senderId}:${eventId}`;
  const ok = await redis.set(dedupKey, "1", "NX", "EX", ttlSec);
  // ok === "OK" => first time, null => duplicate
  return ok !== "OK";
}
