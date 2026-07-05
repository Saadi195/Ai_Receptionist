"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface OrderItem {
  name: string;
  qty: number;
  price: number;
  mods?: string[];
}

interface OrderData {
  order_number?: string;
  items?: OrderItem[];
  total?: number;
  date?: string;
}

export default function OrderSummary() {
  const [orderData, setOrderData] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("latest_order");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setOrderData(parsed);
        } catch {
          // ignore error
        }
      }
      setLoading(false);
    }
  }, []);

  const items = orderData?.items ?? [];
  const total = orderData?.total ?? 0;
  const orderNum = orderData?.order_number ?? "4F3D87";

  return (
    <div className="min-h-screen bg-bg p-8 text-white flex flex-col items-center justify-between">
      {/* Header */}
      <div className="w-full max-w-4xl flex justify-between items-center mb-8">
        <a
          href="/"
          className="text-2xl font-bold tracking-wide bg-gradient-to-r from-primary via-purple-300 to-white bg-clip-text text-transparent"
        >
          Savour Foods AI
        </a>
        <div className="flex items-center gap-2 bg-white bg-opacity-5 px-4 py-1.5 rounded-full border border-white border-opacity-10 text-xs text-text-muted">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
          POS Connected
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-xl w-full flex flex-col items-center my-auto">
        <div className="text-center mb-8">
          <span className="inline-block bg-primary bg-opacity-20 border border-primary border-opacity-50 px-5 py-1.5 rounded-full text-sm font-semibold tracking-wider text-purple-300 mb-4 shadow-[0_0_20px_rgba(138,43,226,0.3)]">
            ORDER #{orderNum}
          </span>
          <h1 className="text-4xl font-bold mb-2">Order Confirmed!</h1>
          <p className="text-text-muted text-sm">
            Apna ticket aur bill POS se hasil karein. Shukriya!
          </p>
        </div>

        {/* Receipt Card */}
        <div className="w-full bg-surface rounded-3xl p-8 border border-white border-opacity-10 shadow-2xl relative overflow-hidden">
          {/* Top glow decoration */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-75"></div>

          <div className="flex justify-between items-center pb-5 border-b border-white border-opacity-10 mb-6">
            <h2 className="text-base font-medium text-purple-300 tracking-wide uppercase">
              Order Details
            </h2>
            <span className="bg-white bg-opacity-5 px-3 py-1 rounded-full text-xs text-text-muted">
              {orderData?.date || "Just now"}
            </span>
          </div>

          {loading ? (
            <div className="py-8 text-center text-text-muted text-sm animate-pulse">
              Loading order summary...
            </div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-text-muted text-sm">
              No active order found in session.
            </div>
          ) : (
            <div className="space-y-5 mb-8 max-h-60 overflow-y-auto pr-2">
              {items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-start">
                  <div>
                    <p className="font-medium text-base text-white">
                      <span className="text-purple-300 font-bold mr-1">{item.qty}×</span>{" "}
                      {item.name}
                    </p>
                    {item.mods && item.mods.length > 0 && (
                      <p className="text-xs text-text-muted mt-0.5">
                        {item.mods.join(", ")}
                      </p>
                    )}
                  </div>
                  <p className="font-medium text-base text-gray-300 tabular-nums">
                    {(item.qty * item.price).toLocaleString()} PKR
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="pt-5 border-t border-white border-opacity-10 space-y-3">
            <div className="flex justify-between text-sm text-text-muted">
              <span>Subtotal</span>
              <span>{total.toLocaleString()} PKR</span>
            </div>
            <div className="flex justify-between text-sm text-text-muted">
              <span>Tax (VAT 0%)</span>
              <span>0 PKR</span>
            </div>
            <div className="flex justify-between text-xl font-bold pt-3 text-white border-t border-white border-opacity-5">
              <span>Grand Total</span>
              <span className="text-purple-300">{total.toLocaleString()} PKR</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-8 w-full flex flex-col sm:flex-row gap-4">
          <a
            href="/"
            className="flex-1 py-3.5 px-6 bg-primary hover:bg-purple-600 text-white rounded-full font-medium flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(138,43,226,0.5)] transition-all text-sm"
          >
            🎙️ Start New Order
          </a>
          <Link
            href="/kitchen"
            className="flex-1 py-3.5 px-6 bg-surface hover:bg-white hover:bg-opacity-10 text-gray-300 hover:text-white border border-white border-opacity-10 rounded-full font-medium flex items-center justify-center gap-2 transition-all text-sm"
          >
            👨‍🍳 View Kitchen Display
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="w-full text-center text-xs text-text-muted mt-8">
        Savour Foods AI Receptionist • Powered by Deepgram & Groq
      </footer>
    </div>
  );
}
