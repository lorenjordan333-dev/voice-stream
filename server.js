const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.get("/", (_req, res) => {
  res.send("voice-stream alive");
});

const server = http.createServer(app);

// IMPORTANT: path must match your Twilio <Stream url=".../stream" />
const wss = new WebSocket.Server({ server, path: "/stream" });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

wss.on("connection", (twilioWs) => {
  console.log("📞 Twilio connected");

  let streamSid = null;
  let openaiReady = false;
  let greetingSent = false;

  const openaiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  function trySendGreeting() {
    if (!openaiReady || !streamSid || greetingSent) return;

    greetingSent = true;

    openaiWs.send(
      JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["audio"],
          instructions: "Say: Hello, how can I help you?",
        },
      })
    );
  }

  openaiWs.on("open", () => {
    console.log("🤖 OpenAI connected");

    openaiWs.send(
      JSON.stringify({
        type: "session.update",
        session: {
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          voice: "alloy",
        },
      })
    );
  });

  openaiWs.on("message", (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch {
      return;
    }

    if (data.type === "session.created") {
      console.log("✅ OpenAI session created");
      openaiReady = true;
      trySendGreeting();
      return;
    }

    if (data.type === "response.audio.delta" && data.delta && streamSid) {
      twilioWs.send(
        JSON.stringify({
          event: "media",
          streamSid,
          media: {
            payload: data.delta,
          },
        })
      );
      return;
    }

    if (data.type === "error") {
      console.log("❌ OpenAI error:", JSON.stringify(data));
    }
  });

  openaiWs.on("error", (err) => {
    console.log("❌ OpenAI error:", err.message);
  });

  openaiWs.on("close", () => {
    console.log("❌ OpenAI disconnected");
    if (twilioWs.readyState === WebSocket.OPEN) {
      twilioWs.close();
    }
  });

  twilioWs.on("message", (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch {
      return;
    }

    if (data.event === "start") {
      streamSid = data.start?.streamSid || null;
      console.log("▶️ Stream started", streamSid);
      trySendGreeting();
      return;
    }

    if (data.event === "media") {
      if (!data.media?.payload) return;
      if (openaiWs.readyState !== WebSocket.OPEN) return;

      openaiWs.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: data.media.payload,
        })
      );
      return;
    }

    if (data.event === "stop") {
      console.log("🛑 Twilio stream stopped");
    }
  });

  twilioWs.on("close", () => {
    console.log("❌ Twilio disconnected");
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });

  twilioWs.on("error", (err) => {
    console.log("❌ Twilio error:", err.message);
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("voice-stream running on port " + PORT);
});
