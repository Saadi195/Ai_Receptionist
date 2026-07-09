"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OrbState } from "../components/Orb";
import ReceiptScreen from "@/components/ReceiptScreen";
import { useAuthStore } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { User, Shield, LogOut } from "lucide-react";
import dynamic from "next/dynamic";
import type { VoiceOrbRef } from "@/components/VoiceOrb";

const VoiceOrb = dynamic(
  () => import("@/components/VoiceOrb"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center"
           style={{ minWidth: 160, minHeight: 160 }}>
        <div className="w-20 h-20 rounded-full bg-surface
             border border-border-strong animate-pulse" />
      </div>
    ),
  }
);

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
  type: "state_update" | "transcript" | "error" | "order_confirmed" | "session_timeout" | "order_cancelled";
  state?: ConversationState;
  current_order?: OrderItem[];
  order_total?: number;
  response_text?: string;
  action?: string;
  session_id?: string;
  text?: string;
  message?: string;
  order_id?: string;
  token?: string;
  items?: any[];
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
  const router = useRouter();
  const supabase = createClient();
  const { accessToken, setAuth, clearAuth, isAuthenticated, isAdmin } = useAuthStore();

  useEffect(() => {
    const initAuth = async () => {
      if (!accessToken) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data: profile } = await supabase
            .from("user_profiles")
            .select("*")
            .eq("id", session.user.id)
            .single();
          const userRole = profile?.role || "admin";
          setAuth(session.access_token, userRole, profile?.display_name || "User", session.user.id);
        }
      }
    };
    initAuth();
  }, [accessToken, setAuth, supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    clearAuth();
  };

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
  const [conversationLog, setConversationLog] = useState<Array<{ sender: "user" | "ai"; text: string }>>([]);
  const transcriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Receipt & Confirmation state ─────────────────────────────────────────
  const [showReceipt, setShowReceipt] = useState(false);
  const [orderToken, setOrderToken] = useState("");
  const [orderId, setOrderId] = useState("");
  const [confirmedTotal, setConfirmedTotal] = useState(0);
  const [confirmedItems, setConfirmedItems] = useState<any[]>([]);
  const [sessionId, setSessionId] = useState("");

  // ── Refs ─────────────────────────────────────────────────────────────────
  const wsRef = useRef<WebSocket | null>(null);
  const vadRef = useRef<VoiceOrbRef | null>(null);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const isSpeakingRef = useRef(false);
  const speechStartTimeRef = useRef(0);
  const sessionActiveRef = useRef(false); // mirror for callbacks
  const pendingReceiptRef = useRef(false);

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

  // ─── Reset session & cleanup state ─────────────────────────────────────
  const resetSession = useCallback(() => {
    sessionActiveRef.current = false;
    pendingReceiptRef.current = false;
    if (vadRef.current) {
      try { vadRef.current.pause(); } catch {}
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    stopCurrentAudio();
    setSessionActive(false);
    setOrbState("sleeping");
    setBackendState("SLEEPING");
    setCurrentOrder([]);
    setOrderTotal(0);
    setAiResponse("");
    setInterimTranscript("");
    setConversationLog([]);
    setShowReceipt(false);
  }, [stopCurrentAudio]);

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
      speechStartTimeRef.current = Date.now();
      setOrbState("speaking");

      source.onended = () => {
        currentSourceRef.current = null;
        isSpeakingRef.current = false;
        if (pendingReceiptRef.current) {
          pendingReceiptRef.current = false;
          setShowReceipt(true);
          if (vadRef.current) {
            try { vadRef.current.pause(); } catch {}
          }
        } else {
          // Return to listening if session still active
          setOrbState((prev) => (prev === "speaking" ? "listening" : prev));
        }
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
            setConversationLog((prev) => [...prev, { sender: "user", text: msg.text! }]);
            // Auto-clear after 3s
            if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current);
            transcriptTimerRef.current = setTimeout(() => setInterimTranscript(""), 3000);
          }

          if (msg.type === "state_update") {
            if (msg.state) setBackendState(msg.state);
            if (msg.current_order) setCurrentOrder(msg.current_order);
            if (typeof msg.order_total === "number") setOrderTotal(msg.order_total);
            if (msg.response_text) {
              setAiResponse(msg.response_text);
              setConversationLog((prev) => [...prev, { sender: "ai", text: msg.response_text! }]);
            }
          }

          if (msg.type === "order_confirmed") {
            setOrderId(msg.order_id || "");
            setOrderToken(msg.token || "");
            setConfirmedTotal(msg.order_total || 0);
            setConfirmedItems(msg.items || []);
            setSessionId(msg.session_id || "");
            if (isSpeakingRef.current) {
              pendingReceiptRef.current = true;
            } else {
              setShowReceipt(true);
              if (vadRef.current) {
                try { vadRef.current.pause(); } catch {}
              }
            }
          }

          if (msg.type === "order_cancelled") {
            setShowReceipt(false);
            if (vadRef.current) {
              try { vadRef.current.pause(); } catch {}
            }
            setAiResponse("Order cancel ho gaya. Agle customer ke liye ready hoon.");

            // Show cancellation message for 3 seconds, then resetSession()
            setTimeout(() => {
              resetSession();
            }, 3000);
          }

          if (msg.type === "session_timeout") {
            // Immediate reset, no delay
            resetSession();
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

  // ─── Speech Handlers for VoiceOrb ───────────────────────────────────────
  const handleSpeechStart = useCallback(() => {
    console.log("SPEECH START FIRED — VAD is detecting voice");
    console.log("wsRef current:", wsRef.current?.readyState);
    console.log("sessionActive:", sessionActiveRef.current);
    if (!sessionActiveRef.current) return;

    // If AI is mid-speech, interrupt it
    if (isSpeakingRef.current) {
      // Prevent self-interruption from speaker echo or room acoustics in the first 1200ms of AI speech
      if (Date.now() - speechStartTimeRef.current < 1200) {
        console.debug("[VAD] Suppressing echo/self-interruption during initial AI playback");
        return;
      }
      stopCurrentAudio();
      // Send interrupt signal to backend so it cancels Groq/TTS streams
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "interrupt" }));
      }
      setOrbState("listening");
    } else {
      setOrbState("listening");
    }
  }, [stopCurrentAudio]);

  const handleSpeechEnd = useCallback((audio: Float32Array) => {
    console.log("SPEECH END FIRED — audio length:", audio.length);
    console.log("wsRef readyState:", wsRef.current?.readyState);
    if (!sessionActiveRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    // VAD gives Float32 @ 16000Hz — convert to Int16 for Deepgram linear16
    const int16 = float32ToInt16(audio);
    wsRef.current.send(int16.buffer);
  }, []);

  // ─── Session start ─────────────────────────────────────────────────────

  const startSession = useCallback(async () => {
    setIsConnecting(true);
    setConnectionError(null);
    setInterimTranscript("");
    setAiResponse("Connecting to AI Receptionist...");
    setConversationLog([]);

    if (typeof window !== "undefined" && (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)) {
      const msg =
        "Microphone access blocked! Browsers require HTTPS or localhost (http://localhost:3000) for mic permissions. If accessing via LAN IP (e.g. 192.168.x.x), please open http://localhost:3000 directly on the host machine or use ngrok/Cloudflare Tunnels.";
      alert(msg);
      setConnectionError(msg);
      setIsConnecting(false);
      return;
    }

    // Initialize and unlock AudioContext during user click gesture to satisfy browser autoplay policy
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }
    } catch (e) {
      console.warn("[AudioContext] Failed to unlock audio on click:", e);
    }

    try {
      await connectWebSocket();
      vadRef.current?.start();
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
  }, [connectWebSocket]);

  // ─── Session stop ──────────────────────────────────────────────────────

  const stopSession = useCallback(() => {
    vadRef.current?.pause();
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
    setConversationLog([]);
    if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current);
  }, [stopCurrentAudio]);

  // ─── Cleanup on unmount ────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopCurrentAudio();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close().catch(() => {});
      }
      if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current);
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

  const isVADSpeaking = sessionActive && userSpeaking;

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
          {isAuthenticated() ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {isAdmin() && (
                <Link
                  href="/admin"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "0.75rem",
                    color: "#fbbf24",
                    textDecoration: "none",
                    background: "rgba(251, 191, 36, 0.1)",
                    padding: "6px 12px",
                    borderRadius: "10px",
                    border: "1px solid rgba(251, 191, 36, 0.25)",
                    fontWeight: 600,
                  }}
                >
                  <Shield size={14} />
                  <span>Admin Panel</span>
                </Link>
              )}
              <button
                onClick={handleLogout}
                title="Sign Out"
                style={{
                  background: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  color: "#f87171",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  padding: "6px",
                  borderRadius: "8px",
                }}
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "0.75rem",
                color: "#f59e0b",
                textDecoration: "none",
                background: "rgba(245, 158, 11, 0.15)",
                padding: "6px 14px",
                borderRadius: "10px",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                fontWeight: 600,
              }}
            >
              <User size={14} />
              <span>Admin Login</span>
            </Link>
          )}
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
          <VoiceOrb
            ref={vadRef}
            sessionActive={sessionActive}
            orbState={orbState}
            onSpeechStart={handleSpeechStart}
            onSpeechEnd={handleSpeechEnd}
            onUserSpeakingChange={setUserSpeaking}
          />

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

        {/* ── Live Conversation Transcript Box (Debug / Mic Check) ── */}
        <div
          style={{
            width: "100%",
            maxWidth: 640,
            background: "rgba(20, 16, 30, 0.9)",
            borderRadius: "16px",
            border: "1px solid rgba(138,43,226,0.35)",
            padding: "1.25rem",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(138,43,226,0.2)", paddingBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#c084fc", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              🎙️ Live Conversation Box (Mic Check)
            </span>
            <span style={{ fontSize: "0.75rem", color: "#a09eb0" }}>
              {conversationLog.length} messages
            </span>
          </div>
          <div
            style={{
              maxHeight: "220px",
              minHeight: "100px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "0.6rem",
              paddingRight: "4px",
            }}
          >
            {conversationLog.length === 0 ? (
              <p style={{ color: "#6d6a7a", fontSize: "0.85rem", fontStyle: "italic", textAlign: "center", margin: "auto 0" }}>
                Speak into your microphone... Your voice and the AI replies will appear here!
              </p>
            ) : (
              conversationLog.map((entry, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: entry.sender === "user" ? "flex-end" : "flex-start",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.7rem",
                      color: entry.sender === "user" ? "#60a5fa" : "#4ade80",
                      marginBottom: "2px",
                      fontWeight: 600,
                    }}
                  >
                    {entry.sender === "user" ? "You (Microphone)" : "AI Receptionist"}
                  </span>
                  <div
                    style={{
                      background: entry.sender === "user" ? "rgba(59,130,246,0.15)" : "rgba(34,197,94,0.12)",
                      border: `1px solid ${entry.sender === "user" ? "rgba(59,130,246,0.3)" : "rgba(34,197,94,0.25)"}`,
                      padding: "8px 12px",
                      borderRadius: "10px",
                      color: "#e2e0f0",
                      fontSize: "0.875rem",
                      maxWidth: "85%",
                      lineHeight: 1.4,
                    }}
                  >
                    {entry.text}
                  </div>
                </div>
              ))
            )}
          </div>
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

        {/* Dev link / Receipt button */}
        <div style={{ marginTop: "auto" }}>
          {orderToken && (
            <button
              onClick={() => setShowReceipt(true)}
              className="w-full bg-gradient-to-r from-emerald-500/20 to-teal-500/20 hover:from-emerald-500/30 hover:to-teal-500/30 border border-emerald-500/40 text-emerald-300 py-2.5 px-4 rounded-xl text-sm font-medium transition duration-200 flex items-center justify-center gap-2 mt-4"
            >
              <span>View Confirmed Receipt (#{orderToken})</span>
            </button>
          )}
        </div>
      </main>

      {showReceipt && (
        <ReceiptScreen
          sessionId={sessionId}
          token={orderToken}
          items={confirmedItems}
          orderTotal={confirmedTotal}
          restaurantName="Savour Foods"
          onClose={() => {
            window.location.reload();
          }}
        />
      )}

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
