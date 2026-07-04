"use client";

import { motion, AnimatePresence } from "framer-motion";

interface OrbProps {
  isRecording?: boolean;
}

export default function Orb({ isRecording = false }: OrbProps) {
  return (
    <div className="relative flex flex-col items-center justify-center w-[400px] h-[400px]">
      
      {/* Volume / Recording Rings */}
      <AnimatePresence>
        {isRecording && (
          <>
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0, 0.5, 0], scale: [1, 1.5, 2] }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
              className="absolute w-64 h-64 rounded-full border border-primary opacity-30"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0, 0.3, 0], scale: [1, 1.8, 2.5] }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 0.5 }}
              className="absolute w-64 h-64 rounded-full border border-primary opacity-20"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0, 0.1, 0], scale: [1, 2.1, 3] }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 1 }}
              className="absolute w-64 h-64 rounded-full border border-primary opacity-10"
            />
          </>
        )}
      </AnimatePresence>

      {/* Floating 3D Orb */}
      <motion.div
        className="relative flex items-center justify-center w-64 h-64 rounded-full z-10"
        animate={{
          y: [0, -15, 0],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          background: "radial-gradient(circle at 30% 30%, #b366ff, #5a189a 60%, #240046)",
          boxShadow: `
            inset -25px -25px 40px rgba(0, 0, 0, 0.6),
            inset 15px 15px 30px rgba(255, 255, 255, 0.4),
            0 0 40px rgba(138, 43, 226, 0.4),
            0 0 80px rgba(138, 43, 226, 0.2)
          `
        }}
      >
        {/* Specular Highlight for extra 3D effect */}
        <div 
          className="absolute top-8 left-12 w-24 h-16 rounded-full opacity-60 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at center, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 70%)",
            transform: "rotate(-30deg)"
          }}
        />

        {/* Eyes Container */}
        <div className="flex gap-3 z-20">
          <motion.div
            className="w-5 h-14 bg-white rounded-full"
            style={{
              boxShadow: "0 0 10px rgba(255, 255, 255, 0.8), inset 0 0 5px rgba(200, 200, 255, 0.5)"
            }}
            animate={{
              scaleY: [1, 1, 0.1, 1, 1],
            }}
            transition={{
              duration: 4,
              times: [0, 0.48, 0.5, 0.52, 1],
              repeat: Infinity,
              repeatDelay: 0.5,
            }}
          />
          <motion.div
            className="w-5 h-14 bg-white rounded-full"
            style={{
              boxShadow: "0 0 10px rgba(255, 255, 255, 0.8), inset 0 0 5px rgba(200, 200, 255, 0.5)"
            }}
            animate={{
              scaleY: [1, 1, 0.1, 1, 1],
            }}
            transition={{
              duration: 4,
              times: [0, 0.48, 0.5, 0.52, 1],
              repeat: Infinity,
              repeatDelay: 0.5,
            }}
          />
        </div>
        
        {/* Secondary bounce reflection at bottom */}
        <div 
          className="absolute bottom-4 left-1/2 -translate-x-1/2 w-32 h-10 rounded-full opacity-40 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at center, #d8b4fe 0%, transparent 70%)"
          }}
        />
      </motion.div>

      {/* Floor Reflection */}
      <motion.div 
        className="absolute bottom-0 w-48 h-16 rounded-[100%] opacity-30 blur-md pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center, rgba(138, 43, 226, 0.8) 0%, rgba(138, 43, 226, 0) 70%)",
        }}
        animate={{
          scale: [1, 0.8, 1],
          opacity: [0.3, 0.1, 0.3],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      
      {/* Background Stars / Dust Particles */}
      {!isRecording && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-full mix-blend-screen opacity-50">
           {/* We can use simple CSS dots for stars */}
           <div className="absolute top-[20%] left-[30%] w-1 h-1 bg-white rounded-full blur-[1px]"></div>
           <div className="absolute top-[40%] left-[80%] w-1.5 h-1.5 bg-primary rounded-full blur-[1px]"></div>
           <div className="absolute top-[70%] left-[20%] w-1 h-1 bg-white rounded-full blur-[1px]"></div>
           <div className="absolute top-[80%] left-[70%] w-2 h-2 bg-primary rounded-full blur-[2px]"></div>
           <div className="absolute top-[30%] left-[70%] w-1 h-1 bg-white rounded-full blur-[1px]"></div>
        </div>
      )}
    </div>
  );
}
