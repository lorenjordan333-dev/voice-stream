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
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  openaiWs.on("open", () => {
    console.log("🤖 OpenAI connected");

    // Setup session
    openaiWs.send(
      JSON.stringify({
        type: "session.update",
        session: {
          turn_detection: { type: "server_vad" },
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          voice: "alloy",
        },
      })
    );

    // 🔥 Force first response (so you hear something)
    openaiWs.send(
      JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["audio"],
          instructions: "Say: Hello, how can I help you?",
        },
      })
    );
  });

  // 👉 FROM TWILIO → OPENAI
  ws.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(message);
    } catch (e) {
      return;
    }

    if (data.event === "start") {
      console.log("▶️ Stream started");
    }

    if (data.event === "media") {
      if (openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: data.media.payload,
          })
        );
      }
    }
  });

  // 👉 FROM OPENAI → TWILIO (SEND AUDIO BACK 🔥)
  openaiWs.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(message);
    } catch (e) {
      return;
    }

    if (data.type === "response.audio.delta" && data.delta) {
      ws.send(
        JSON.stringify({
          event: "media",
          streamSid: streamSid,
          media: {
            payload: data.delta,
          },
        })
      );
    }
  });

  ws.on("close", () => {
    console.log("❌ Twilio disconnected");
    openaiWs.close();
  });

  openaiWs.on("close", () => {
    console.log("❌ OpenAI disconnected");
  });

  openaiWs.on("error", (err) => {
    console.error("OpenAI error:", err.message);
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("voice-stream running on port " + PORT);
});
