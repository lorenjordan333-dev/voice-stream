const express = require("express");
const http = require("http");
const WebSocket = require("ws");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

// IMPORTANT: /stream path
const wss = new WebSocket.Server({ server, path: "/stream" });

wss.on("connection", (ws) => {
  console.log("📞 Twilio connected");

  let streamSid = null;
  let openaiReady = false;
  let silenceTimer = null;
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

  // --- OPENAI CONNECT ---
  openaiWs.on("open", () => {
    console.log("🤖 OpenAI connected");

    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        voice: "marin",
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        input_audio_transcription: {
          model: "gpt-4o-mini-transcribe"
        }
      }
    }));
  });

  // --- OPENAI MESSAGES ---
  openaiWs.on("message", (msg) => {
    let data;
    try { data = JSON.parse(msg.toString()); } catch { return; }

    // 🔥 SESSION READY → SEND FIRST RESPONSE
    if (data.type === "session.created") {
      openaiReady = true;

      openaiWs.send(JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["audio"],
          instructions: "Say: Hello, this is Kelly, how can I help you?"
        }
      }));
      return;
    }

    // 🔥 SEND AUDIO BACK TO TWILIO (THIS WAS MISSING)
    if (data.type === "response.audio.delta" && streamSid) {
      ws.send(JSON.stringify({
        event: "media",
        streamSid: streamSid,
        media: {
          payload: data.delta
        }
      }));
    }

    if (data.type === "response.completed") {
      lastAiEndTime = Date.now();
    }
  });

  // --- TWILIO MESSAGES ---
  ws.on("message", (msg) => {
    let data;
    try { data = JSON.parse(msg.toString()); } catch { return; }

    if (data.event === "start") {
      streamSid = data.start.streamSid;
      console.log("▶️ Stream started:", streamSid);
      return;
    }

    if (data.event === "media") {
      const payload = data.media?.payload;
      if (!payload) return;

      if (payload.length > 200) {
        hasAudio = true;
      }

      if (!openaiReady) return;

      openaiWs.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: payload
      }));

      if (silenceTimer) clearTimeout(silenceTimer);

      silenceTimer = setTimeout(() => {
        if (!hasAudio) return;
        if (Date.now() - lastAiEndTime < 800) return;

        openaiWs.send(JSON.stringify({
          type: "input_audio_buffer.commit"
        }));

        openaiWs.send(JSON.stringify({
          type: "response.create"
        }));

        hasAudio = false;

      }, 400);
    }
  });

  ws.on("close", () => {
    console.log("❌ Twilio disconnected");
    openaiWs.close();
  });

  openaiWs.on("close", () => {
    console.log("❌ OpenAI disconnected");
    ws.close();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("🚀 voice-stream running on port " + PORT);
});
