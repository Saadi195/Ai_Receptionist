"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Orb from "../components/Orb";
import type { OrbState } from "../components/Orb";
import { useMicVAD } from "@ricky0123/vad-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConversationState =
  | "SLEEPING"
  | "GREETING"
  | "TAKING_ORDER"
  | "ITEM_DISAMBIGUATION"
  | "QUANTITY_CONFIRM"
  | "ADD_MORE"
  | "MENU_QUERY"
  | "ORDER_CONFIRM";

interface OrderItem {
  name: string;
  qty: number;
  price: number;
  mods?: string[];
}

interface WsStateUpdate {
  type: "state_update" | "transcript" | "error";
  state?: ConversationState;
  current_order?: OrderItem[];
  order_total?: number;
  response_text?: string;
  text?: string;
  message?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WS_URL = process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? "ws://localhost:8000";

const RESTAURANT_NAME =
  process.env.NEXT_PUBLIC_RESTAURANT_NAME ?? "Savour Foods AI";

const STATE_LABELS: Record<ConversationState, string> = {
  SLEEPING: "Intezaar mein...",
  GREETING: "Khush Aamdeed!",
  TAKING_ORDER: "Order le raha hoon",
  ITEM_DISAMBIGUATION: "Thoda aur batao...",
  QUANTITY_CONFIRM: "Quantity confirm kar raha hoon",
  ADD_MORE: "Kuch aur?",
  MENU_QUERY: "Menu dekh raha hoon",
  ORDER_CONFIRM: "Order confirm ho gaya",
};

const IDLE_STATUS_TEXT =
  "Start Ordering button press karein";

// ─── Audio helpers ────────────────────────────────────────────────────────────

/**
 * Converts Float32Array (VAD output, range -1..1) to Int16Array (linear PCM).
 * Required because Deepgram backend expects encoding=linear16.
 */
function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = float32[i];
    int16[i] = Math.max(-32768, Math.min(32767, Math.round(s * (s < 0 ? 32768 : 32767))));
  }
  return int16;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  // ── Session & connection state ───────────────────────────────────────────
  const [sessionActive, setSessionActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // ── Conversation state ───────────────────────────────────────────────────
  const [backendState, setBackendState] = useState<ConversationState>("SLEEPING");
  const [orbState, setOrbState] = useState<OrbState>("sleeping");

  // ── Order data ───────────────────────────────────────────────────────────
  const [currentOrder, setCurrentOrder] = useState<OrderItem[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);

  // ── Transcript ───────────────────────────────────────────────────────────
  const [interimTranscript, setInterimTranscript] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const transcriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const isSpeakingRef = useRef(false);
  const sessionActiveRef = useRef(false); // mirror for callbacks

  // Keep sessionActiveRef in sync
  useEffect(() => {
    sessionActiveRef.current = sessionActive;
  }, [sessionActive]);

  // ─── Stop current TTS playback ─────────────────────────────────────────

  const stopCurrentAudio = useCallback(() => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {
        // already stopped
      }
      currentSourceRef.current = null;
    }
    isSpeakingRef.current = false;
  }, []);

  // ─── Play TTS audio bytes ──────────────────────────────────────────────

  const playAudioBytes = useCallback(async (bytes: ArrayBuffer) => {
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") await ctx.resume();

      const buffer = await ctx.decodeAudioData(bytes.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      currentSourceRef.current = source;
      isSpeakingRef.current = true;
      setOrbState("speaking");

      source.onended = () => {
        currentSourceRef.current = null;
        isSpeakingRef.current = false;
        // Return to listening if session still active
        setOrbState((prev) => (prev === "speaking" ? "listening" : prev));
      };

      source.start();
    } catch (err) {
      console.error("[Audio playback error]", err);
      isSpeakingRef.current = false;
      setOrbState((prev) => (prev === "speaking" ? "listening" : prev));
    }
  }, []);

  // ─── WebSocket ─────────────────────────────────────────────────────────

  const connectWebSocket = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_URL}/ws/voice`);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        wsRef.current = ws;
        setConnectionError(null);
        resolve();
      };

      ws.onmessage = async (event) => {
        // Binary = TTS audio
        if (event.data instanceof ArrayBuffer) {
          await playAudioBytes(event.data);
          return;
        }
        // Blob (some browsers) = TTS audio
        if (event.data instanceof Blob) {
          const buf = await event.data.arrayBuffer();
          await playAudioBytes(buf);
          return;
        }
        // Text = JSON control message
        try {
          const msg: WsStateUpdate = JSON.parse(event.data as string);

          if (msg.type === "transcript" && msg.text) {
            setInterimTranscript(msg.text);
            // Auto-clear after 3s
            if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current);
            transcriptTimerRef.current = setTimeout(() => setInterimTranscript(""), 3000);
          }

          if (msg.type === "state_update") {
            if (msg.state) setBackendState(msg.state);
            if (msg.current_order) setCurrentOrder(msg.current_order);
            if (typeof msg.order_total === "number") setOrderTotal(msg.order_total);
            if (msg.response_text) setAiResponse(msg.response_text);

            // Session complete → reset after short delay
            if (msg.state === "SLEEPING" && sessionActiveRef.current) {
              setTimeout(() => {
                stopCurrentAudio();
                setSessionActive(false);
                setOrbState("sleeping");
                setCurrentOrder([]);
                setOrderTotal(0);
                setBackendState("SLEEPING");
                setInterimTranscript("");
                setAiResponse("Order complete! Naya order dene ke liye dobara Start karein.");
              }, 3500);
            }
          }

          if (msg.type === "error") {
            setConnectionError(msg.message ?? "Backend error occurred");
          }
        } catch {
          // Non-JSON — ignore
        }
      };

      ws.onerror = () => {
        setConnectionError(
          "Backend se connect nahi ho saka. Make sure uvicorn port 8000 pe chal raha hai."
        );
        reject(new Error("WebSocket connection failed"));
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (sessionActiveRef.current) {
          setConnectionError("Connection lost. Naya session start karein.");
          setSessionActive(false);
          setOrbState("sleeping");
          stopCurrentAudio();
        }
      };
    });
  }, [playAudioBytes, stopCurrentAudio]);

  // ─── VAD hook — Phase 4 core ────────────────────────────────────────────
  //
  // Replaces Phase 3 MediaRecorder entirely.
  // - onSpeechStart: fires the instant human voice detected → interruption
  // - onSpeechEnd:   fires with complete Float32Array utterance → send to backend
  // - workletURL / modelURL must point to files in /public

  const vad = useMicVAD({
    startOnLoad: false, // do not activate until startSession()

    onSpeechStart: () => {
      if (!sessionActiveRef.current) return;

      // If AI is mid-speech, interrupt it
      if (isSpeakingRef.current) {
        stopCurrentAudio();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "interruption" }));
        }
      }

      setOrbState("listening");
    },

    onSpeechEnd: (audio: Float32Array) => {
      if (!sessionActiveRef.current) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      // VAD gives Float32 @ 16000Hz — convert to Int16 for Deepgram linear16
      const int16 = float32ToInt16(audio);
      wsRef.current.send(int16.buffer);
    },

    onVADMisfire: () => {
      // Too short to be real speech — ignore
      console.debug("[VAD] misfire — too short");
    },

    // Static asset paths — files must exist in /public
    // vad-web 0.0.36 ships silero_vad_legacy.onnx (not silero_vad.onnx)
    workletURL: "/vad.worklet.bundle.min.js",
    modelURL: "/silero_vad_legacy.onnx",

    // Tuned for restaurant noise environment (noisy kitchen background)
    positiveSpeechThreshold: 0.8,  // Higher = fewer false positives from clatter
    negativeSpeechThreshold: 0.7,  // Hysteresis gap
    minSpeechFrames: 3,            // Min frames before utterance is confirmed
    preSpeechPadFrames: 5,         // Capture frames before VAD triggered
    redemptionFrames: 10,          // Frames of silence before speech segment ends
  });

  // ─── Session start ─────────────────────────────────────────────────────

  const startSession = useCallback(async () => {
    setIsConnecting(true);
    setConnectionError(null);
    setInterimTranscript("");
    setAiResponse("Connecting to AI Receptionist...");

    try {
      await connectWebSocket();
      vad.start();
      setSessionActive(true);
      setOrbState("listening");
    } catch (err) {
      let message = "Session start karne mein masla. Dobara try karein.";
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        message =
          "Microphone permission denied. Browser settings mein mic access allow karein.";
      } else if (err instanceof Error) {
        message = err.message;
      }
      setConnectionError(message);
    } finally {
      setIsConnecting(false);
    }
  }, [connectWebSocket, vad]);

  // ─── Session stop ──────────────────────────────────────────────────────

  const stopSession = useCallback(() => {
    vad.pause();
    stopCurrentAudio();
    wsRef.current?.close();
    wsRef.current = null;
    setSessionActive(false);
    setOrbState("sleeping");
    setBackendState("SLEEPING");
    setCurrentOrder([]);
    setOrderTotal(0);
    setInterimTranscript("");
    setAiResponse("");
    if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current);
  }, [vad, stopCurrentAudio]);

  // ─── Cleanup on unmount ────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopSession();
      audioCtxRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Derived UI values ─────────────────────────────────────────────────

  const statusBadgeLabel = sessionActive
    ? (STATE_LABELS[backendState] ?? backendState)
    : "AI Receptionist Active";

  const statusText = sessionActive
    ? (backendState === "SLEEPING" ? IDLE_STATUS_TEXT : "")
    : "";

  const isVADSpeaking = sessionActive && vad.userSpeaking;

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center relative overflow-hidden"
      style={{ background: "#0d0914" }}
    >
      {/* Ambient background blobs */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse 60% 40% at 20% 10%, rgba(138,43,226,0.12) 0%, transparent 70%), radial-gradient(ellipse 50% 60% at 80% 90%, rgba(59,130,246,0.08) 0%, transparent 70%)",
        }}
      />

      {/* ── Header ── */}
      <header
        className="w-full flex justify-between items-center px-6 py-5 z-10 shrink-0"
        style={{ borderBottom: "1px solid rgba(138,43,226,0.15)" }}
      >
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            background: "linear-gradient(90deg, #8a2be2, #c084fc, #fff)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {RESTAURANT_NAME}
        </h1>
        <div className="flex items-center gap-4">
          {/* Connection dot */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "0.75rem",
              color: "#a09eb0",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: sessionActive ? "#22c55e" : "#4b5563",
                display: "inline-block",
                boxShadow: sessionActive ? "0 0 8px #22c55e" : "none",
              }}
            />
            {sessionActive ? "Connected" : "Offline"}
          </div>
          <Link
            href="/kitchen"
            style={{ fontSize: "0.875rem", color: "#a09eb0", textDecoration: "none" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#a09eb0")}
          >
            Kitchen Display →
          </Link>
        </div>
      </header>

      {/* ── Error banner ── */}
      {connectionError && (
        <div
          style={{
            width: "100%",
            maxWidth: 640,
            margin: "0.5rem 1rem",
            padding: "10px 16px",
            borderRadius: 10,
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.35)",
            color: "#fca5a5",
            fontSize: "0.85rem",
            textAlign: "center",
            zIndex: 20,
          }}
        >
          {connectionError}
        </div>
      )}

      {/* ── VAD voice-detected banner ── */}
      {isVADSpeaking && (
        <div
          style={{
            width: "100%",
            maxWidth: 640,
            margin: "0 1rem",
            padding: "6px 16px",
            borderRadius: 10,
            background: "rgba(138,43,226,0.08)",
            border: "1px solid rgba(138,43,226,0.25)",
            color: "#c084fc",
            fontSize: "0.75rem",
            textAlign: "center",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            zIndex: 20,
          }}
        >
          Voice detected...
        </div>
      )}

      {/* ── Main ── */}
      <main
        className="flex-1 w-full max-w-5xl flex flex-col items-center px-4 py-6 z-10"
        style={{ gap: "1.5rem" }}
      >
        {/* ── Orb Section ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
          <Orb state={orbState} />

          {/* State Badge */}
          <div
            style={{
              padding: "4px 16px",
              borderRadius: "999px",
              fontSize: "0.75rem",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              background:
                orbState === "listening"
                  ? "rgba(59,130,246,0.15)"
                  : orbState === "speaking"
                  ? "rgba(34,197,94,0.15)"
                  : "rgba(100,116,139,0.15)",
              color:
                orbState === "listening"
                  ? "#60a5fa"
                  : orbState === "speaking"
                  ? "#4ade80"
                  : "#94a3b8",
              border: `1px solid ${
                orbState === "listening"
                  ? "rgba(59,130,246,0.3)"
                  : orbState === "speaking"
                  ? "rgba(34,197,94,0.3)"
                  : "rgba(100,116,139,0.2)"
              }`,
            }}
          >
            {statusBadgeLabel}
          </div>

          {statusText && (
            <p style={{ color: "#a09eb0", fontSize: "0.875rem", textAlign: "center", maxWidth: 380, lineHeight: 1.6 }}>
              {statusText}
            </p>
          )}

          {/* Interim transcript — what the customer is saying right now */}
          {interimTranscript && (
            <p
              style={{
                color: "#c084fc",
                fontSize: "0.85rem",
                fontStyle: "italic",
                textAlign: "center",
                maxWidth: 440,
                background: "rgba(138,43,226,0.08)",
                border: "1px solid rgba(138,43,226,0.2)",
                borderRadius: 8,
                padding: "6px 14px",
              }}
            >
              &ldquo;{interimTranscript}&rdquo;
            </p>
          )}

          {/* AI's last response */}
          {aiResponse && (
            <p
              style={{
                color: "#e2e0f0",
                fontSize: "1rem",
                textAlign: "center",
                maxWidth: 520,
                lineHeight: 1.65,
                minHeight: "2.5rem",
              }}
            >
              {aiResponse}
            </p>
          )}

          {/* Start / Stop buttons */}
          {!sessionActive ? (
            <button
              id="btn-start-session"
              onClick={startSession}
              disabled={isConnecting}
              style={{
                marginTop: "0.25rem",
                padding: "12px 32px",
                borderRadius: "999px",
                border: "none",
                cursor: isConnecting ? "not-allowed" : "pointer",
                fontWeight: 600,
                fontSize: "0.95rem",
                background: isConnecting
                  ? "rgba(138,43,226,0.4)"
                  : "linear-gradient(135deg, #8a2be2, #4b0082)",
                color: "#fff",
                boxShadow: "0 0 24px rgba(138,43,226,0.4)",
                transition: "transform 0.15s, box-shadow 0.15s",
                display: "flex",
                alignItems: "center",
                gap: 8,
                opacity: isConnecting ? 0.7 : 1,
              }}
              onMouseEnter={(e) => {
                if (!isConnecting) {
                  e.currentTarget.style.transform = "scale(1.05)";
                  e.currentTarget.style.boxShadow = "0 0 36px rgba(138,43,226,0.6)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
                e.currentTarget.style.boxShadow = "0 0 24px rgba(138,43,226,0.4)";
              }}
            >
              {isConnecting ? (
                <>
                  <svg
                    style={{ width: 18, height: 18, animation: "spin 1s linear infinite" }}
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Connecting...
                </>
              ) : (
                <>🎤&nbsp; Start Ordering</>
              )}
            </button>
          ) : (
            <button
              id="btn-stop-session"
              onClick={stopSession}
              style={{
                padding: "8px 24px",
                borderRadius: "999px",
                border: "1px solid rgba(255,255,255,0.1)",
                cursor: "pointer",
                fontWeight: 500,
                fontSize: "0.85rem",
                background: "transparent",
                color: "#94a3b8",
                transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(239,68,68,0.5)";
                e.currentTarget.style.color = "#f87171";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                e.currentTarget.style.color = "#94a3b8";
              }}
            >
              ■ End Session
            </button>
          )}
        </div>

        {/* ── Two-column: Order card (only when items exist) ── */}
        {currentOrder.length > 0 && (
          <div
            style={{
              width: "100%",
              maxWidth: 400,
              background: "rgba(26,21,37,0.85)",
              borderRadius: "16px",
              border: "1px solid rgba(138,43,226,0.25)",
              padding: "1.25rem",
              backdropFilter: "blur(8px)",
              animation: "fadeIn 0.3s ease",
            }}
          >
            <p
              style={{
                fontSize: "0.7rem",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#6d6a7a",
                marginBottom: "1rem",
              }}
            >
              🧾 Aap ka Order
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {currentOrder.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "0.875rem",
                  }}
                >
                  <span style={{ color: "#d4d0e8" }}>
                    {item.qty}× {item.name}
                    {item.mods && item.mods.length > 0 && (
                      <span style={{ color: "#6d6a7a", fontSize: "0.75rem" }}>
                        {" "}
                        ({item.mods.join(", ")})
                      </span>
                    )}
                  </span>
                  <span style={{ color: "#a09eb0", fontVariantNumeric: "tabular-nums" }}>
                    {(item.qty * item.price).toLocaleString()} PKR
                  </span>
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: "1rem",
                paddingTop: "0.75rem",
                borderTop: "1px solid rgba(138,43,226,0.15)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontWeight: 600, color: "#c084fc" }}>Total</span>
              <span style={{ fontWeight: 700, fontSize: "1.1rem", color: "#fff" }}>
                {orderTotal.toLocaleString()} PKR
              </span>
            </div>
          </div>
        )}

        {/* Dev link */}
        <div style={{ marginTop: "auto" }}>
          <Link
            href="/order-summary"
            style={{ color: "#4b4560", fontSize: "0.75rem", textDecoration: "none" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#a09eb0")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#4b4560")}
          >
            Dev: Order Summary →
          </Link>
        </div>
      </main>

      {/* Inline keyframes */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
