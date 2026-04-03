const express = require("express");
const http = require("http");
const WebSocket = require("ws");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

app.get("/", (req, res) => {
  res.send("voice-stream alive");
});

const wss = new WebSocket.Server({ server, path: "/stream" });

wss.on("connection", (ws) => {
  console.log("📞 Twilio connected");

  let streamSid = null;

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

    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        modalities: ["audio"],
        voice: "alloy",
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw"
      }
    }));

    // 🔥 immediate greeting (prevents disconnect)
    openaiWs.send(JSON.stringify({
      type: "response.create",
      response: {
        modalities: ["audio"],
        instructions: "Say: Hello, this is Kelly, how can I help you?"
      }
    }));
  });

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    if (data.event === "start") {
      streamSid = data.start.streamSid;
      return;
    }

    if (data.event === "media") {
      if (openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: data.media.payload
        }));
      }
    }
  });

  openaiWs.on("message", (msg) => {
    const response = JSON.parse(msg);

    if (response.type === "response.audio.delta" && streamSid) {
      ws.send(JSON.stringify({
        event: "media",
        streamSid: streamSid,
        media: {
          payload: response.delta
        }
      }));
    }
  });

  ws.on("close", () => openaiWs.close());
  openaiWs.on("close", () => ws.close());
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("voice-stream running on port " + PORT);
});
