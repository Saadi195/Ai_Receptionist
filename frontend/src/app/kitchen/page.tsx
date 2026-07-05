"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────────
interface OrderItem {
  name: string;
  qty: number;
  price: number;
  mods?: string[];
}

interface Order {
  id: string;
  created_at: string;
  items: OrderItem[];
  total_amount: number;
  status: "pending" | "preparing" | "ready";
  session_id: string;
  isNew?: boolean; // flash animation flag
}

// ─── Supabase Client ──────────────────────────────────────────────────────────
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function shortId(uuid: string): string {
  return uuid.slice(-6).toUpperCase();
}

// ─── Order Card ───────────────────────────────────────────────────────────────
function OrderCard({
  order,
  onStatusChange,
}: {
  order: Order;
  onStatusChange: (id: string, status: "preparing" | "ready") => void;
}) {
  const isPending = order.status === "pending";
  const isPreparing = order.status === "preparing";

  return (
    <div
      id={`order-card-${order.id}`}
      style={{
        background: "rgba(26,21,37,0.9)",
        borderRadius: "16px",
        padding: "1.25rem",
        border: order.isNew
          ? "2px solid rgba(34,197,94,0.7)"
          : order.status === "preparing"
          ? "1px solid rgba(251,191,36,0.4)"
          : "1px solid rgba(138,43,226,0.2)",
        boxShadow: order.isNew ? "0 0 20px rgba(34,197,94,0.25)" : "none",
        transition: "border 0.4s, box-shadow 0.4s",
        animation: order.isNew ? "newOrderFlash 2s ease" : undefined,
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700, fontSize: "1.1rem", color: "#c084fc", letterSpacing: "0.05em" }}>
          #{shortId(order.session_id || order.id)}
        </span>
        <span style={{ fontSize: "0.75rem", color: "#6d6a7a" }}>{formatTime(order.created_at)}</span>
      </div>

      {/* Status badge */}
      <div>
        <span style={{
          padding: "3px 10px", borderRadius: "999px", fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
          background: isPending ? "rgba(251,191,36,0.12)" : isPreparing ? "rgba(59,130,246,0.12)" : "rgba(34,197,94,0.12)",
          color: isPending ? "#fbbf24" : isPreparing ? "#60a5fa" : "#4ade80",
          border: `1px solid ${isPending ? "rgba(251,191,36,0.3)" : isPreparing ? "rgba(59,130,246,0.3)" : "rgba(34,197,94,0.3)"}`,
        }}>
          {isPending ? "Naya Order" : isPreparing ? "Ban raha hai" : "Tayyar!"}
        </span>
      </div>

      {/* Items */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {Array.isArray(order.items) ? order.items.map((item, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}>
            <span style={{ color: "#d4d0e8" }}>
              <strong style={{ color: "#fff" }}>{item.qty}×</strong> {item.name}
              {item.mods && item.mods.length > 0 && (
                <span style={{ color: "#6d6a7a", fontSize: "0.75rem" }}> ({item.mods.join(", ")})</span>
              )}
            </span>
            <span style={{ color: "#a09eb0", fontVariantNumeric: "tabular-nums" }}>
              {(item.qty * item.price).toLocaleString()} PKR
            </span>
          </div>
        )) : (
          <p style={{ color: "#6d6a7a", fontSize: "0.8rem" }}>No items</p>
        )}
      </div>

      {/* Total */}
      <div style={{
        paddingTop: "0.6rem", borderTop: "1px solid rgba(138,43,226,0.12)",
        display: "flex", justifyContent: "space-between",
      }}>
        <span style={{ color: "#a09eb0", fontSize: "0.85rem" }}>Total</span>
        <span style={{ fontWeight: 700, color: "#fff" }}>{order.total_amount?.toLocaleString()} PKR</span>
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {isPending && (
          <button
            id={`btn-preparing-${order.id}`}
            onClick={() => onStatusChange(order.id, "preparing")}
            style={{
              flex: 1, padding: "8px", borderRadius: "8px", border: "1px solid rgba(59,130,246,0.4)",
              background: "rgba(59,130,246,0.12)", color: "#60a5fa", fontSize: "0.8rem",
              fontWeight: 600, cursor: "pointer", transition: "background 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(59,130,246,0.25)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(59,130,246,0.12)")}
          >
            👨‍🍳 Preparing
          </button>
        )}
        {(isPending || isPreparing) && (
          <button
            id={`btn-ready-${order.id}`}
            onClick={() => onStatusChange(order.id, "ready")}
            style={{
              flex: 1, padding: "8px", borderRadius: "8px", border: "1px solid rgba(34,197,94,0.4)",
              background: "rgba(34,197,94,0.12)", color: "#4ade80", fontSize: "0.8rem",
              fontWeight: 600, cursor: "pointer", transition: "background 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(34,197,94,0.25)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(34,197,94,0.12)")}
          >
            ✅ Ready
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function KitchenDisplay() {
  const restaurantName = process.env.NEXT_PUBLIC_RESTAURANT_NAME ?? "Restaurant AI";

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionLost, setConnectionLost] = useState(false);

  // Create Supabase client
  const supabase = createClient(supabaseUrl, supabaseKey);

  // ── Fetch active orders (pending + preparing, sorted oldest first) ────────────
  const fetchOrders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .neq("status", "ready")
        .order("created_at", { ascending: true });

      if (error) throw error;
      setOrders((data as Order[]) ?? []);
      setConnectionLost(false);
    } catch (err) {
      console.error("[Kitchen] fetch error:", err);
      setConnectionLost(true);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update order status ───────────────────────────────────────────────────────
  const handleStatusChange = useCallback(
    async (orderId: string, newStatus: "preparing" | "ready") => {
      try {
        const { error } = await supabase
          .from("orders")
          .update({ status: newStatus })
          .eq("id", orderId);

        if (error) throw error;

        if (newStatus === "ready") {
          // Remove from display immediately
          setOrders((prev) => prev.filter((o) => o.id !== orderId));
        } else {
          setOrders((prev) =>
            prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
          );
        }
      } catch (err) {
        console.error("[Kitchen] status update error:", err);
        alert("Status update fail ho gaya. Dobara try karein.");
      }
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Initial fetch + Realtime subscription ────────────────────────────────────
  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel("kitchen-orders")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload) => {
          const newOrder = { ...(payload.new as Order), isNew: true };
          setOrders((prev) => {
            // Avoid duplicates
            if (prev.find((o) => o.id === newOrder.id)) return prev;
            return [...prev, newOrder].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          });
          // Remove flash after 3s
          setTimeout(() => {
            setOrders((prev) =>
              prev.map((o) => (o.id === newOrder.id ? { ...o, isNew: false } : o))
            );
          }, 3000);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders" },
        (payload) => {
          const updated = payload.new as Order;
          if (updated.status === "ready") {
            setOrders((prev) => prev.filter((o) => o.id !== updated.id));
          } else {
            setOrders((prev) =>
              prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o))
            );
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnectionLost(false);
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          setConnectionLost(true);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingOrders = orders.filter((o) => o.status === "pending");
  const preparingOrders = orders.filter((o) => o.status === "preparing");

  return (
    <div style={{ minHeight: "100vh", background: "#0d0914", color: "#fff", padding: "1.5rem 2rem" }}>
      {/* Global keyframes */}
      <style>{`
        @keyframes newOrderFlash {
          0%   { box-shadow: 0 0 0 0 rgba(34,197,94,0.0); border-color: rgba(34,197,94,0.0); }
          20%  { box-shadow: 0 0 30px 6px rgba(34,197,94,0.5); border-color: rgba(34,197,94,0.9); }
          60%  { box-shadow: 0 0 20px 3px rgba(34,197,94,0.3); border-color: rgba(34,197,94,0.7); }
          100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.0); border-color: rgba(34,197,94,0.2); }
        }
      `}</style>

      {/* ── Header ── */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", borderBottom: "1px solid rgba(138,43,226,0.2)", paddingBottom: "1rem" }}>
        <div>
          <h1 style={{
            fontSize: "1.4rem", fontWeight: 700, letterSpacing: "0.05em",
            background: "linear-gradient(90deg, #8a2be2, #c084fc, #fff)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            Kitchen Display
          </h1>
          <p style={{ color: "#6d6a7a", fontSize: "0.8rem", marginTop: 2 }}>{restaurantName}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Live order counts */}
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div style={{ padding: "6px 14px", borderRadius: "999px", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", fontSize: "0.8rem", color: "#fbbf24" }}>
              🟡 Pending: {pendingOrders.length}
            </div>
            <div style={{ padding: "6px 14px", borderRadius: "999px", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", fontSize: "0.8rem", color: "#60a5fa" }}>
              🔵 Preparing: {preparingOrders.length}
            </div>
          </div>
          <a href="/" style={{ fontSize: "0.8rem", color: "#a09eb0", textDecoration: "none" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={e => (e.currentTarget.style.color = "#a09eb0")}>
            ← Back to Ordering
          </a>
        </div>
      </header>

      {/* ── Connection Lost Banner ── */}
      {connectionLost && (
        <div style={{
          padding: "12px 20px", borderRadius: "10px", marginBottom: "1rem",
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)",
          color: "#f87171", fontSize: "0.875rem", display: "flex", alignItems: "center", gap: "8px",
        }}>
          ⚠️ Connection lost — reconnecting... Supabase Realtime check karein.
        </div>
      )}

      {/* ── Content ── */}
      {loading ? (
        <div style={{ textAlign: "center", color: "#6d6a7a", marginTop: "4rem" }}>
          Orders load ho rahe hain...
        </div>
      ) : orders.length === 0 ? (
        <div style={{
          textAlign: "center", marginTop: "5rem",
          display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem",
        }}>
          <div style={{ fontSize: "3rem" }}>🍽️</div>
          <p style={{ color: "#4b4560", fontSize: "1rem" }}>Abhi koi active order nahi hai</p>
          <p style={{ color: "#3a3550", fontSize: "0.8rem" }}>Naaye orders automatically yahan nazar aayenge</p>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start" }}>

          {/* ── Pending Column ── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem" }}>
            <h2 style={{
              fontSize: "0.85rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
              color: "#fbbf24", display: "flex", alignItems: "center", gap: "8px",
            }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fbbf24", display: "inline-block", boxShadow: "0 0 8px #fbbf24" }} />
              Naye Orders ({pendingOrders.length})
            </h2>
            {pendingOrders.length === 0 ? (
              <p style={{ color: "#3a3550", fontSize: "0.8rem", padding: "1rem" }}>Koi naya order nahi</p>
            ) : (
              pendingOrders.map((order) => (
                <OrderCard key={order.id} order={order} onStatusChange={handleStatusChange} />
              ))
            )}
          </div>

          {/* ── Preparing Column ── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem" }}>
            <h2 style={{
              fontSize: "0.85rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
              color: "#60a5fa", display: "flex", alignItems: "center", gap: "8px",
            }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#60a5fa", display: "inline-block", boxShadow: "0 0 8px #60a5fa" }} />
              Ban Raha Hai ({preparingOrders.length})
            </h2>
            {preparingOrders.length === 0 ? (
              <p style={{ color: "#3a3550", fontSize: "0.8rem", padding: "1rem" }}>Abhi kuch nahi ban raha</p>
            ) : (
              preparingOrders.map((order) => (
                <OrderCard key={order.id} order={order} onStatusChange={handleStatusChange} />
              ))
            )}
          </div>

        </div>
      )}
    </div>
  );
}
