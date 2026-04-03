const WebSocket = require("ws");
const http = require("http");

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

wss.on("connection", (ws) => {
  console.log("📞 Twilio connected");

  const openaiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  openaiWs.on("open", () => {
    console.log("🤖 OpenAI connected");

    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "alloy"
      }
    }));
  });

  openaiWs.on("error", (err) => {
    console.log("❌ OpenAI error:", err.message);
  });

  openaiWs.on("close", () => {
    console.log("❌ OpenAI disconnected");
  });

  ws.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    if (data.event === "start") {
      console.log("▶️ Stream started");
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

  openaiWs.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    if (data.type === "session.updated") {
      console.log("✅ Session ready, triggering greeting");
      openaiWs.send(JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["audio"],
          instructions: "Say: Hello, how can I help you?"
        }
      }));
    }

    if (data.type === "response.audio.delta") {
      ws.send(JSON.stringify({
        event: "media",
        media: {
          payload: data.delta
        }
      }));
    }
  });

  ws.on("close", () => {
    console.log("❌ Twilio disconnected");
    openaiWs.close();
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("voice-stream running on port " + PORT);
});
