const WebSocket = require("ws");
const http = require("http");

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

wss.on("connection", (ws) => {
  console.log("📞 Twilio connected");

  const openaiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
    {
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  openaiWs.on("open", () => {
    console.log("🤖 OpenAI connected");

    // Start session
    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        turn_detection: { type: "server_vad" },
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: "alloy"
      }
    }));
  });

  // 👉 FROM TWILIO → TO OPENAI
  ws.on("message", (message) => {
    const data = JSON.parse(message);

    if (data.event === "media") {
      openaiWs.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: data.media.payload
      }));
    }

    if (data.event === "start") {
      console.log("▶️ Stream started");
    }
  });

  // 👉 FROM OPENAI → TO TWILIO (THIS WAS MISSING 🔥)
  openaiWs.on("message", (message) => {
    const data = JSON.parse(message);

    if (data.type === "response.audio.delta" && data.delta) {
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

  openaiWs.on("close", () => {
    console.log("❌ OpenAI disconnected");
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("voice-stream running on port " + PORT);
});
