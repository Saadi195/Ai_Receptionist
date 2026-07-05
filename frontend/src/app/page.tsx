"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Orb, { OrbState } from "../components/Orb";

// ─── Types ────────────────────────────────────────────────────────────────────
interface OrderItem {
  name: string;
  qty: number;
  price: number;
  mods?: string[];
}

interface StateUpdate {
  type: "state_update";
  state: string;
  current_order: OrderItem[];
  order_total: number;
  response_text: string;
}

interface ChatMessage {
  role: "user" | "ai";
  text: string;
  timestamp: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function backendState2OrbState(backendState: string): OrbState {
  if (backendState === "SLEEPING") return "sleeping";
  if (backendState === "GREETING" || backendState === "TAKING_ORDER" ||
      backendState === "ITEM_DISAMBIGUATION" || backendState === "QUANTITY_CONFIRM" ||
      backendState === "ADD_MORE" || backendState === "MENU_QUERY") return "listening";
  if (backendState === "ORDER_CONFIRM") return "speaking";
  return "sleeping";
}

const STATE_LABELS: Record<string, string> = {
  SLEEPING: "Intezaar mein...",
  GREETING: "Khush Aamdeed!",
  TAKING_ORDER: "Order le raha hoon",
  ITEM_DISAMBIGUATION: "Thoda aur batao...",
  QUANTITY_CONFIRM: "Quantity confirm kar raha hoon",
  ADD_MORE: "Kuch aur?",
  MENU_QUERY: "Menu dekh raha hoon",
  ORDER_CONFIRM: "Order confirm ho gaya",
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function Home() {
  const restaurantName = process.env.NEXT_PUBLIC_RESTAURANT_NAME ?? "Restaurant AI";
  const wsUrl = `${process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? "ws://localhost:8000"}/ws/voice`;

  // Permission + connection state
  const [micPermission, setMicPermission] = useState<"idle" | "granted" | "denied">("idle");
  const [wsConnected, setWsConnected] = useState(false);

  // AI state machine
  const [backendState, setBackendState] = useState("SLEEPING");
  const [orbState, setOrbState] = useState<OrbState>("sleeping");

  // Order data
  const [currentOrder, setCurrentOrder] = useState<OrderItem[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);

  // Conversation transcript (last 5 exchanges max)
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Refs for WebSocket + audio
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const isSpeakingRef = useRef(false);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // ── Audio playback via Web Audio API ────────────────────────────────────────
  const playAudioBytes = useCallback(async (bytes: ArrayBuffer) => {
    try {
      if (!audioContextRef.current || audioContextRef.current.state === "closed") {
        audioContextRef.current = new AudioContext();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") await ctx.resume();

      const buffer = await ctx.decodeAudioData(bytes.slice(0)); // slice = copy
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      setOrbState("speaking");
      isSpeakingRef.current = true;

      source.onended = () => {
        isSpeakingRef.current = false;
        // After speaking, go back to listening state (unless backend said SLEEPING)
        setOrbState((prev) => (prev === "speaking" ? "listening" : prev));
      };
      source.start(0);
    } catch (err) {
      console.error("[Audio playback error]", err);
      isSpeakingRef.current = false;
    }
  }, []);

  // ── WebSocket message handler ────────────────────────────────────────────────
  const handleWsMessage = useCallback(
    async (event: MessageEvent) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data) as StateUpdate;
          if (msg.type === "state_update") {
            setBackendState(msg.state);
            setCurrentOrder(msg.current_order ?? []);
            setOrderTotal(msg.order_total ?? 0);

            if (!isSpeakingRef.current) {
              setOrbState(backendState2OrbState(msg.state));
            }

            if (msg.response_text) {
              setTranscript((prev) =>
                [...prev, { role: "ai" as const, text: msg.response_text, timestamp: new Date() }].slice(-10)
              );
            }
          }
        } catch {
          // Non-JSON text, ignore
        }
      } else if (event.data instanceof Blob) {
        const arrayBuffer = await event.data.arrayBuffer();
        await playAudioBytes(arrayBuffer);
      } else if (event.data instanceof ArrayBuffer) {
        await playAudioBytes(event.data);
      }
    },
    [playAudioBytes]
  );

  // ── Connect WebSocket + start streaming microphone ───────────────────────────
  const connectAndStream = useCallback(async () => {
    // Get microphone access
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
      });
    } catch {
      setMicPermission("denied");
      return;
    }
    setMicPermission("granted");

    // Open AudioContext early so it's not blocked
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContext();
    }

    // Open WebSocket
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      setWsConnected(true);
      setOrbState("listening");

      // Start MediaRecorder
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          e.data.arrayBuffer().then((buf) => ws.send(buf));
        }
      };
      recorder.start(250); // 250ms chunks
    };

    ws.onmessage = handleWsMessage;

    ws.onclose = () => {
      setWsConnected(false);
      setOrbState("sleeping");
      mediaRecorderRef.current?.stop();
    };

    ws.onerror = (err) => {
      console.error("[WebSocket error]", err);
    };
  }, [wsUrl, handleWsMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      mediaRecorderRef.current?.stop();
    };
  }, []);

  // ── Status text for sleep state ──────────────────────────────────────────────
  const statusText =
    backendState === "SLEEPING"
      ? "\"Hello AI Receptionist\" bol kar order shuru karein"
      : STATE_LABELS[backendState] ?? backendState;

  return (
    <div className="min-h-screen w-full flex flex-col items-center relative overflow-hidden" style={{ background: "#0d0914" }}>
      {/* Ambient background blobs */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 60% 40% at 20% 10%, rgba(138,43,226,0.12) 0%, transparent 70%), radial-gradient(ellipse 50% 60% at 80% 90%, rgba(59,130,246,0.08) 0%, transparent 70%)",
      }} />

      {/* ── Header ── */}
      <header className="w-full flex justify-between items-center px-6 py-5 z-10 shrink-0" style={{ borderBottom: "1px solid rgba(138,43,226,0.15)" }}>
        <h1 style={{
          fontSize: "1.5rem", fontWeight: 700, letterSpacing: "0.05em",
          background: "linear-gradient(90deg, #8a2be2, #c084fc, #fff)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>
          {restaurantName}
        </h1>
        <div className="flex items-center gap-4">
          {/* Connection dot */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.75rem", color: "#a09eb0" }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: wsConnected ? "#22c55e" : "#4b5563",
              display: "inline-block",
              boxShadow: wsConnected ? "0 0 8px #22c55e" : "none",
            }} />
            {wsConnected ? "Connected" : "Offline"}
          </div>
          <Link href="/kitchen" style={{ fontSize: "0.875rem", color: "#a09eb0", textDecoration: "none" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={e => (e.currentTarget.style.color = "#a09eb0")}>
            Kitchen Display →
          </Link>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 w-full max-w-5xl flex flex-col items-center px-4 py-6 z-10" style={{ gap: "1.5rem" }}>

        {/* ── Orb Section ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
          <Orb state={orbState} />

          {/* State Badge */}
          <div style={{
            padding: "4px 16px", borderRadius: "999px", fontSize: "0.75rem", fontWeight: 600,
            letterSpacing: "0.08em", textTransform: "uppercase",
            background: orbState === "listening" ? "rgba(59,130,246,0.15)"
              : orbState === "speaking" ? "rgba(34,197,94,0.15)"
              : "rgba(100,116,139,0.15)",
            color: orbState === "listening" ? "#60a5fa"
              : orbState === "speaking" ? "#4ade80"
              : "#94a3b8",
            border: `1px solid ${orbState === "listening" ? "rgba(59,130,246,0.3)"
              : orbState === "speaking" ? "rgba(34,197,94,0.3)"
              : "rgba(100,116,139,0.2)"}`,
          }}>
            {STATE_LABELS[backendState] ?? backendState}
          </div>

          {/* Status text */}
          <p style={{ color: "#a09eb0", fontSize: "0.875rem", textAlign: "center", maxWidth: 380, lineHeight: 1.6 }}>
            {statusText}
          </p>

          {/* Allow microphone button — shown ONLY before permission granted */}
          {micPermission === "idle" && (
            <button
              id="btn-allow-mic"
              onClick={connectAndStream}
              style={{
                marginTop: "0.5rem",
                padding: "12px 32px",
                borderRadius: "999px",
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.95rem",
                background: "linear-gradient(135deg, #8a2be2, #4b0082)",
                color: "#fff",
                boxShadow: "0 0 24px rgba(138,43,226,0.4)",
                transition: "transform 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 0 36px rgba(138,43,226,0.6)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 0 24px rgba(138,43,226,0.4)"; }}
            >
              🎤&nbsp; Allow Microphone
            </button>
          )}
          {micPermission === "denied" && (
            <p style={{ color: "#f87171", fontSize: "0.8rem" }}>
              Microphone access denied. Browser settings mein permission enable karein.
            </p>
          )}
        </div>

        {/* ── Two-column: Transcript + Order Card ── */}
        <div style={{ display: "flex", gap: "1.5rem", width: "100%", alignItems: "flex-start" }}>

          {/* ── Conversation Transcript ── */}
          <div style={{
            flex: 1,
            background: "rgba(26,21,37,0.7)",
            borderRadius: "16px",
            border: "1px solid rgba(138,43,226,0.15)",
            padding: "1.25rem",
            minHeight: 220,
            backdropFilter: "blur(8px)",
          }}>
            <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "#6d6a7a", marginBottom: "1rem" }}>
              Conversation
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: 280, overflowY: "auto" }}>
              {transcript.length === 0 ? (
                <p style={{ color: "#4b4560", fontSize: "0.85rem", textAlign: "center", marginTop: "2rem" }}>
                  Abhi koi baat-cheet nahi hui...
                </p>
              ) : (
                transcript.map((msg, i) => (
                  <div key={i} style={{
                    display: "flex",
                    flexDirection: msg.role === "ai" ? "row" : "row-reverse",
                    gap: "8px",
                    alignItems: "flex-start",
                  }}>
                    {/* Avatar */}
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                      background: msg.role === "ai"
                        ? "linear-gradient(135deg, #8a2be2, #4b0082)"
                        : "rgba(59,130,246,0.2)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "0.65rem",
                    }}>
                      {msg.role === "ai" ? "🤖" : "👤"}
                    </div>
                    {/* Bubble */}
                    <div style={{
                      maxWidth: "75%",
                      padding: "8px 12px",
                      borderRadius: msg.role === "ai" ? "4px 12px 12px 12px" : "12px 4px 12px 12px",
                      background: msg.role === "ai"
                        ? "rgba(138,43,226,0.15)"
                        : "rgba(59,130,246,0.12)",
                      border: `1px solid ${msg.role === "ai" ? "rgba(138,43,226,0.25)" : "rgba(59,130,246,0.2)"}`,
                      fontSize: "0.85rem",
                      lineHeight: 1.5,
                      color: "#e2e0f0",
                    }}>
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>

          {/* ── Order Card ── */}
          {currentOrder.length > 0 && (
            <div style={{
              width: 280,
              background: "rgba(26,21,37,0.85)",
              borderRadius: "16px",
              border: "1px solid rgba(138,43,226,0.25)",
              padding: "1.25rem",
              backdropFilter: "blur(8px)",
              animation: "fadeIn 0.3s ease",
            }}>
              <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "#6d6a7a", marginBottom: "1rem" }}>
                🧾 Aap ka Order
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                {currentOrder.map((item, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.875rem" }}>
                    <span style={{ color: "#d4d0e8" }}>
                      {item.qty}× {item.name}
                      {item.mods && item.mods.length > 0 && (
                        <span style={{ color: "#6d6a7a", fontSize: "0.75rem" }}> ({item.mods.join(", ")})</span>
                      )}
                    </span>
                    <span style={{ color: "#a09eb0", fontVariantNumeric: "tabular-nums" }}>
                      {(item.qty * item.price).toLocaleString()} PKR
                    </span>
                  </div>
                ))}
              </div>
              <div style={{
                marginTop: "1rem", paddingTop: "0.75rem",
                borderTop: "1px solid rgba(138,43,226,0.15)",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontWeight: 600, color: "#c084fc" }}>Total</span>
                <span style={{ fontWeight: 700, fontSize: "1.1rem", color: "#fff" }}>
                  {orderTotal.toLocaleString()} PKR
                </span>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Inline keyframe for order card entry */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}
