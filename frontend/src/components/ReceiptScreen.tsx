"use client";

import React, { useState } from "react";

export interface OrderItem {
  name?: string;
  canonical_name?: string;
  qty?: number | string;
  quantity?: number | string;
  price?: number;
  unit_price?: number;
  mods?: string[];
  modifications?: {
    type?: string;
    ingredient?: string;
    display?: string;
    urdu_display?: string;
  }[];
  special_note?: string;
  line_total?: number;
  [key: string]: any;
}

interface ReceiptScreenProps {
  sessionId: string;
  token: string;
  items: OrderItem[];
  orderTotal: number;
  restaurantName: string;
  onClose: () => void;
}

function calcLineTotal(unitPrice: number, qty: string): number {
  try {
    const q = parseFloat(qty.toLowerCase().replace("kg", "").trim());
    return isNaN(q) || q <= 0 ? unitPrice : Math.round(unitPrice * q);
  } catch {
    return unitPrice;
  }
}

export default function ReceiptScreen({
  sessionId,
  token,
  items,
  orderTotal,
  restaurantName = "Savour Foods",
  onClose,
}: ReceiptScreenProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  // Calculate subtotal defensively
  const calculatedSubtotal = items.reduce((sum, item) => {
    const up = Number(item.unit_price ?? item.price ?? 0);
    const q = String(item.quantity ?? item.qty ?? "1");
    return sum + calcLineTotal(up, q);
  }, 0);

  const finalDisplayTotal = calculatedSubtotal > 0 ? calculatedSubtotal : orderTotal;

  const downloadPDF = () => {
    setIsGenerating(true);

    const generate = () => {
      try {
        const { jsPDF } = (window as any).jspdf;
        // 80mm width (receipt paper), portrait
        const doc = new jsPDF({ unit: "mm", format: [80, 200] });

        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text(restaurantName, 40, 15, { align: "center" });

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(`Date: ${new Date().toLocaleString()}`, 40, 22, { align: "center" });
        if (sessionId) {
          doc.text(`Session: ${sessionId}`, 40, 27, { align: "center" });
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.text(`TOKEN: ${token}`, 40, 36, { align: "center" });

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text("-----------------------------------------", 40, 42, { align: "center" });

        let y = 49;
        items.forEach((item) => {
          const up = Number(item.unit_price ?? item.price ?? 0);
          const qStr = String(item.quantity ?? item.qty ?? "1");
          const name = item.canonical_name ?? item.name ?? "Item";
          const lt = calcLineTotal(up, qStr);

          // Truncate long names to fit 80mm width
          const displayQtyName = `${qStr}x ${name}`.slice(0, 26);
          doc.text(displayQtyName, 5, y);
          doc.text(`PKR ${lt}`, 75, y, { align: "right" });
          y += 6;

          if (item.modifications && Array.isArray(item.modifications) && item.modifications.length > 0) {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(8);
            item.modifications.forEach((mod: any) => {
              const modText = `-> ${mod.display || mod.ingredient || "Modification"}`.slice(0, 35);
              doc.text(modText, 10, y);
              y += 4.5;
            });
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
          }
          if (item.special_note && typeof item.special_note === "string" && item.special_note.trim() !== "") {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(8);
            const noteText = `-> Note: ${item.special_note.trim()}`.slice(0, 35);
            doc.text(noteText, 10, y);
            y += 4.5;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
          }
        });

        doc.text("-----------------------------------------", 40, y + 2, { align: "center" });
        y += 9;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text(`Total: PKR ${finalDisplayTotal}`, 75, y, { align: "right" });
        y += 12;

        doc.setFont("helvetica", "italic");
        doc.setFontSize(9);
        doc.text("Shukriya! Mehrbani farmaiye.", 40, y, { align: "center" });
        doc.text("Please collect your receipt at POS.", 40, y + 5, { align: "center" });

        doc.save(`savour-foods-${token}.pdf`);
      } catch (err) {
        console.error("Failed to generate PDF:", err);
        alert("PDF generation failed. Please check console.");
      } finally {
        setIsGenerating(false);
      }
    };

    if ((window as any).jspdf) {
      generate();
    } else {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      script.onload = () => generate();
      script.onerror = () => {
        alert("Failed to load jsPDF library.");
        setIsGenerating(false);
      };
      document.head.appendChild(script);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
      <div className="w-full max-w-md bg-slate-900/95 border border-slate-700/80 rounded-3xl shadow-2xl p-6 text-slate-100 flex flex-col gap-6 relative overflow-hidden">
        {/* Top Glow Accent */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500" />

        {/* Header */}
        <div className="text-center flex flex-col items-center gap-2 mt-2">
          <div className="w-14 h-14 bg-emerald-500/20 rounded-full flex items-center justify-center border border-emerald-500/30 text-emerald-400 mb-1">
            <svg
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">
            Order Confirmed!
          </h2>
          <p className="text-sm text-slate-400">{restaurantName}</p>
          <p className="text-xs text-slate-500">
            {new Date().toLocaleDateString()}{" "}
            {new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>

        {/* Token Box */}
        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4 text-center">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest block mb-1">
            Your Order Token
          </span>
          <span className="text-3xl font-mono font-extrabold text-emerald-400 tracking-widest">
            {token}
          </span>
        </div>

        {/* Itemized List */}
        <div className="flex flex-col gap-3 max-h-60 overflow-y-auto pr-1 divide-y divide-slate-800">
          {items.map((item, idx) => {
            const up = Number(item.unit_price ?? item.price ?? 0);
            const qStr = String(item.quantity ?? item.qty ?? "1");
            const name = item.canonical_name ?? item.name ?? "Item";
            const lt = calcLineTotal(up, qStr);
            const mods = Array.isArray(item.modifications) ? item.modifications : [];
            const note = typeof item.special_note === "string" ? item.special_note.trim() : "";

            return (
              <div
                key={idx}
                className="flex flex-col pt-3 first:pt-0 text-sm gap-1"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded-md border border-emerald-800/40">
                      {qStr}x
                    </span>
                    <span className="font-medium text-slate-200">{name}</span>
                  </div>
                  <span className="font-mono text-slate-300">PKR {lt}</span>
                </div>
                {(mods.length > 0 || note !== "") && (
                  <div className="flex flex-col pl-6 space-y-0.5 text-xs text-amber-300 font-medium">
                    {mods.map((mod: any, mIdx: number) => (
                      <div key={mIdx} className="flex items-center gap-1.5">
                        <span className="text-amber-400/80">↳</span>
                        <span>{mod.display || mod.ingredient || "Modification"}</span>
                      </div>
                    ))}
                    {note !== "" && (
                      <div className="flex items-center gap-1.5 text-yellow-300">
                        <span className="text-yellow-400/80">↳</span>
                        <span>Note: {note}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Total Divider */}
        <div className="border-t-2 border-dashed border-slate-700 pt-4 flex items-center justify-between text-lg font-bold">
          <span className="text-slate-300">Total Amount</span>
          <span className="text-emerald-400 font-mono text-xl">
            PKR {finalDisplayTotal}
          </span>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3 mt-2">
          <button
            onClick={downloadPDF}
            disabled={isGenerating}
            className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 disabled:opacity-50 text-white font-semibold py-3.5 px-6 rounded-2xl shadow-lg shadow-emerald-900/30 transition duration-200 flex items-center justify-center gap-2"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span>{isGenerating ? "Generating PDF..." : "Download Receipt (PDF)"}</span>
          </button>

          <button
            onClick={onClose}
            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium py-3.5 px-6 rounded-2xl border border-slate-700 transition duration-200 text-center"
          >
            ← Go Back / Start New Order
          </button>
        </div>
      </div>
    </div>
  );
}
