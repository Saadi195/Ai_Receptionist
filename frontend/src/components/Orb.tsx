"use client";

import { motion, AnimatePresence } from "framer-motion";

export type OrbState = "sleeping" | "listening" | "speaking";

interface OrbProps {
  state?: OrbState;
}

export default function Orb({ state = "sleeping" }: OrbProps) {
  const isListening = state === "listening";
  const isSpeaking = state === "speaking";
  const isSleeping = state === "sleeping";

  let backgroundGradient = "radial-gradient(circle at 30% 30%, #64748b, #334155 60%, #0f172a)";
  let boxShadow = "inset -10px -10px 20px rgba(0, 0, 0, 0.6), inset 10px 10px 15px rgba(255, 255, 255, 0.2), 0 0 20px rgba(100, 116, 139, 0.3)";
  let ringColor = "border-slate-500";

  if (isListening) {
    backgroundGradient = "radial-gradient(circle at 30% 30%, #60a5fa, #2563eb 60%, #1e3a8a)";
    boxShadow = "inset -10px -10px 20px rgba(0, 0, 0, 0.6), inset 10px 10px 15px rgba(255, 255, 255, 0.4), 0 0 40px rgba(59, 130, 246, 0.6), 0 0 80px rgba(59, 130, 246, 0.3)";
    ringColor = "border-blue-500";
  } else if (isSpeaking) {
    backgroundGradient = "radial-gradient(circle at 30% 30%, #4ade80, #16a34a 60%, #14532d)";
    boxShadow = "inset -10px -10px 20px rgba(0, 0, 0, 0.6), inset 10px 10px 15px rgba(255, 255, 255, 0.4), 0 0 40px rgba(34, 197, 94, 0.6), 0 0 80px rgba(34, 197, 94, 0.3)";
    ringColor = "border-green-500";
  }

  return (
    <div className="relative flex flex-col items-center justify-center w-64 h-64">
      {/* Listening Pulse Rings */}
      <AnimatePresence>
        {isListening && (
          <>
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0, 0.6, 0], scale: [1, 1.4, 1.8] }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
              className={`absolute w-40 h-40 rounded-full border-2 ${ringColor} opacity-40`}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0, 0.4, 0], scale: [1, 1.6, 2.2] }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut", delay: 0.4 }}
              className={`absolute w-40 h-40 rounded-full border ${ringColor} opacity-20`}
            />
          </>
        )}
      </AnimatePresence>

      {/* Speaking Wave Bars / Rings */}
      <AnimatePresence>
        {isSpeaking && (
          <>
            <motion.div
              animate={{ scale: [1, 1.25, 1.1, 1.35, 1], opacity: [0.3, 0.7, 0.4, 0.8, 0.3] }}
              transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
              className="absolute w-44 h-44 rounded-full bg-green-500/20 blur-md"
            />
            <motion.div
              animate={{ scale: [1, 1.4, 1], rotate: [0, 180, 360] }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              className="absolute w-52 h-52 rounded-full border border-dashed border-green-400/40"
            />
          </>
        )}
      </AnimatePresence>

      {/* Main Orb (160px) */}
      <motion.div
        className="relative flex items-center justify-center w-40 h-40 rounded-full z-10 transition-all duration-500"
        animate={
          isSleeping
            ? { y: 0 }
            : {
                y: [0, -8, 0],
                scale: isSpeaking ? [1, 1.05, 1] : 1,
              }
        }
        transition={{
          duration: isSpeaking ? 0.6 : 3,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          background: backgroundGradient,
          boxShadow: boxShadow,
        }}
      >
        <div
          className="absolute top-4 left-6 w-14 h-8 rounded-full opacity-60 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at center, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 70%)",
            transform: "rotate(-30deg)",
          }}
        />

        {isSpeaking ? (
          <div className="flex items-center gap-1.5 z-20 h-10">
            {[1, 2, 3, 4, 5].map((i) => (
              <motion.div
                key={i}
                className="w-1.5 bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]"
                animate={{
                  height: ["12px", `${16 + (i % 3) * 14}px`, "12px"],
                }}
                transition={{
                  duration: 0.4 + i * 0.1,
                  repeat: Infinity,
                  repeatType: "reverse",
                  ease: "easeInOut",
                }}
              />
            ))}
          </div>
        ) : (
          <div className="flex gap-3 z-20">
            <motion.div
              className={`w-3.5 h-10 rounded-full ${isSleeping ? "bg-slate-400" : "bg-white"}`}
              style={{
                boxShadow: isSleeping ? "none" : "0 0 10px rgba(255, 255, 255, 0.8)",
              }}
              animate={isSleeping ? {} : { scaleY: [1, 1, 0.1, 1, 1] }}
              transition={{
                duration: 4,
                times: [0, 0.48, 0.5, 0.52, 1],
                repeat: Infinity,
                repeatDelay: 0.5,
              }}
            />
            <motion.div
              className={`w-3.5 h-10 rounded-full ${isSleeping ? "bg-slate-400" : "bg-white"}`}
              style={{
                boxShadow: isSleeping ? "none" : "0 0 10px rgba(255, 255, 255, 0.8)",
              }}
              animate={isSleeping ? {} : { scaleY: [1, 1, 0.1, 1, 1] }}
              transition={{
                duration: 4,
                times: [0, 0.48, 0.5, 0.52, 1],
                repeat: Infinity,
                repeatDelay: 0.5,
              }}
            />
          </div>
        )}
      </motion.div>

      <div
        className="absolute bottom-6 w-32 h-8 rounded-full opacity-30 blur-md pointer-events-none transition-all duration-500"
        style={{
          background: isListening
            ? "rgba(59, 130, 246, 0.6)"
            : isSpeaking
            ? "rgba(34, 197, 94, 0.6)"
            : "rgba(100, 116, 139, 0.3)",
        }}
      />
    </div>
  );
}
