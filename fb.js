import axios from "axios";

export async function fbSendText(pageAccessToken, psid, text) {
  await axios.post(
    "https://graph.facebook.com/v19.0/me/messages",
    { recipient: { id: psid }, message: { text } },
    { params: { access_token: pageAccessToken }, timeout: 8000 }
  );
}

export async function fbTyping(pageAccessToken, psid, on = true) {
  await axios.post(
    "https://graph.facebook.com/v19.0/me/messages",
    { recipient: { id: psid }, sender_action: on ? "typing_on" : "typing_off" },
    { params: { access_token: pageAccessToken }, timeout: 8000 }
  );
}
