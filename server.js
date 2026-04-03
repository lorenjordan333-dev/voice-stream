const express = require("express");
const http = require("http");
const WebSocket = require("ws");
require("dotenv").config();

const app = express();

app.get("/", (req, res) => {
  res.send("voice-stream alive");
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/stream" });

wss.on("connection", (ws) => {
  console.log("📞 Twilio connected");

  let streamSid = null;
  let openaiReady = false;
  let silenceTimer = null;
  let aiSpeaking = false;
  let hasAudio = false;
  let lastAiEndTime = 0;

  const openaiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  openaiWs.on("open", () => {
    console.log("🤖 OpenAI connected");

    openaiReady = true;

    openaiWs.send(
      JSON.stringify({
        type: "session.update",
        session: {
          instructions: `You are Kelly, a professional locksmith dispatcher.

START:
Always say:
"Locksmith services, hi, this is Kelly, how can I help?"

STYLE:
Be natural, calm, and human.
Speak in short sentences.
Listen more than you talk.

BEHAVIOR:
- Always wait for the customer to finish speaking.
- Do not interrupt.
- Do not rush.
- If the customer is silent, wait.

FLOW:
Understand what the customer needs.
Ask simple questions if something is unclear.

Do not assume.
Do not jump ahead.

Once you understand:
Ask for the address.
Wait for the full address.
Repeat it clearly and confirm.

After confirmation:
Say:
"I'm going to send a technician, he will be there shortly."

FLEXIBILITY:
If the customer changes their mind or corrects you, adapt naturally and continue.

PRICE:
Only if the customer asks:
Service call is 45 dollars.

TIME:
Only if the customer asks:
About 20 to 25 minutes.

ENDING:
Do not end the conversation unless the customer says goodbye.`,
          voice: "marin",
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          input_audio_transcription: {
            model: "gpt-4o-mini-transcribe",
          },
        },
      })
    );

    openaiWs.send(
      JSON.stringify({
        type: "response.create",
      })
    );
  });

  ws.on("message", (msg) => {
    let data;

    try {
      data = JSON.parse(typeof msg === "string" ? msg : msg.toString());
    } catch (e) {
      console.error("Twilio WS parse error:", e.message);
      return;
    }

    if (data.event === "start") {
      streamSid = data.start.streamSid;
      console.log("▶️ Stream started:", streamSid);
      return;
    }

    if (data.event === "media") {
      const payload = data.media && data.media.payload;
      if (!payload) return;

      if (payload.length > 200) {
        hasAudio = true;
      }

      if (aiSpeaking && payload.length > 500) {
        openaiWs.send(
          JSON.stringify({
            type: "response.cancel",
          })
        );
        aiSpeaking = false;
      }

      if (!openaiReady) return;
      if (openaiWs.readyState !== WebSocket.OPEN) return;

      openaiWs.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: payload,
        })
      );

      if (silenceTimer) clearTimeout(silenceTimer);

      silenceTimer = setTimeout(() => {
        if (!hasAudio) return;
        if (Date.now() - lastAiEndTime < 1500) return;
        if (openaiWs.readyState !== WebSocket.OPEN) return;

        openaiWs.send(
          JSON.stringify({
            type: "input_audio_buffer.commit",
          })
        );

        openaiWs.send(
          JSON.stringify({
            type: "response.create",
          })
        );

        hasAudio = false;
      }, 1000);
    }
  });

  openaiWs.on("message", (msg) => {
    let response;

    try {
      response = JSON.parse(msg.toString());
    } catch (e) {
      console.error("OpenAI WS parse error:", e.message);
      return;
    }

    if (response.type === "response.audio.delta") {
      aiSpeaking = true;

      if (!streamSid) return;

      ws.send(
        JSON.stringify({
          event: "media",
          streamSid,
          media: { payload: response.delta },
        })
      );
    }

    if (response.type === "response.completed") {
      aiSpeaking = false;
      lastAiEndTime = Date.now();
    }

    if (
      response.type === "conversation.item.input_audio_transcription.completed"
    ) {
      const text = response.transcript;

      if (text && text.length > 2) {
        console.log("🗣️ USER:", text);
      }
    }

    if (response.type === "error") {
      console.error("❌ OpenAI error:", JSON.stringify(response));
    }
  });

  ws.on("close", () => {
    console.log("❌ Twilio disconnected");
    if (silenceTimer) clearTimeout(silenceTimer);
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });

  ws.on("error", (err) => {
    console.error("❌ Twilio WS error:", err.message);
  });

  openaiWs.on("close", () => {
    console.log("❌ OpenAI disconnected");
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  openaiWs.on("error", (err) => {
    console.error("❌ OpenAI WS error:", err.message);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("🚀 voice-stream running on port " + PORT);
});
