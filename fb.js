import axios from "axios";

export async function fbSendText(pageAccessToken, psid, text) {
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      {
        recipient: { id: psid },
        messaging_type: "RESPONSE",
        message: { text }
      },
      { params: { access_token: pageAccessToken } }
    );
  } catch (err) {
    console.error("FB send error:", err?.response?.data || err?.message);
  }
}

export async function fbTyping(pageAccessToken, psid, isOn) {
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      {
        recipient: { id: psid },
        sender_action: isOn ? "typing_on" : "typing_off"
      },
      { params: { access_token: pageAccessToken } }
    );
  } catch (err) {
    // typing errors مش مهمة قوي
  }
}
