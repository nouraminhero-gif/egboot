// apps/webhook/fb.js

import axios from "axios";

const FB_API_URL = "https://graph.facebook.com/v19.0/me/messages";

// axios instance علشان الأداء و التنظيم
const fbApi = axios.create({
  baseURL: FB_API_URL,
  timeout: 10000, // 10 ثواني
});

/**
 * إرسال رسالة نصية
 */
export async function fbSendText(pageAccessToken, psid, text) {
  if (!pageAccessToken || !psid || !text) return;

  try {
    await fbApi.post(
      "",
      {
        recipient: { id: psid },
        messaging_type: "RESPONSE",
        message: { text },
      },
      {
        params: { access_token: pageAccessToken },
      }
    );
  } catch (err) {
    console.error(
      "❌ FB send text error:",
      err?.response?.data || err?.message || err
    );
  }
}

/**
 * typing on / off
 */
export async function fbTyping(pageAccessToken, psid, isOn = true) {
  if (!pageAccessToken || !psid) return;

  try {
    await fbApi.post(
      "",
      {
        recipient: { id: psid },
        sender_action: isOn ? "typing_on" : "typing_off",
      },
      {
        params: { access_token: pageAccessToken },
      }
    );
  } catch {
    // typing errors مش مهمة ومش محتاجة log
  }
}
