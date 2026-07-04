"use client";

import Link from "next/link";
import { useState } from "react";
import Orb from "../components/Orb";

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);

  const toggleRecording = () => {
    setIsRecording(!isRecording);
  };

  return (
    <div className="h-[100dvh] w-full flex flex-col items-center overflow-hidden relative">
      
      {/* Header - Fixed to top, full width */}
      <header className="w-full flex justify-between items-center p-6 md:p-8 shrink-0 z-50">
        <h1 className="text-2xl md:text-3xl font-bold tracking-wide bg-gradient-to-r from-primary via-purple-300 to-white bg-clip-text text-transparent">
          AI Receptionist
        </h1>
        <div className="flex gap-4 items-center">
          <Link href="/kitchen" className="text-sm md:text-base text-text-muted hover:text-white transition-colors">Kitchen</Link>
          <div className="w-8 h-8 rounded-full bg-surface border border-primary border-opacity-30"></div>
        </div>
      </header>

      {/* Main Content Area - Flexible height */}
      <main className="flex-1 w-full max-w-4xl flex flex-col items-center justify-center px-4 min-h-0 relative z-10">
        
        {/* Responsive Orb Container */}
        <div className="flex-1 flex items-center justify-center min-h-[30vh] md:min-h-[40vh] w-full">
          <div className="scale-75 md:scale-100 transition-transform">
             <Orb isRecording={isRecording} />
          </div>
        </div>

        {/* Text and Button Container */}
        <div className="shrink-0 flex flex-col items-center w-full pb-8 md:pb-12 gap-6 md:gap-8 text-center mt-auto">
          <div className="space-y-3">
            <p className="text-xs md:text-sm uppercase tracking-widest text-primary font-semibold">
              {isRecording ? "Listening..." : "AI Receptionist Active"}
            </p>
            <h2 className="text-xl md:text-2xl font-medium text-white leading-relaxed max-w-3xl px-4 transition-all h-[80px] md:h-[90px] flex items-center justify-center">
              {isRecording 
                ? "I am listening... Please speak your order."
                : "Assalam-o-Alaikum! Welcome to Savour Foods. I'm your AI ordering assistant. You may place your order in Urdu, English or a mix of both. Press Start Ordering whenever you're ready."
              }
            </h2>
          </div>

          <button 
            onClick={toggleRecording}
            className={`px-8 md:px-10 py-4 md:py-5 rounded-full font-medium flex items-center gap-3 transition-all text-sm md:text-base ${
              isRecording 
              ? "bg-red-500 hover:bg-red-600 text-white shadow-[0_0_30px_rgba(239,68,68,0.5)]" 
              : "bg-primary hover:bg-primary-dark text-white shadow-[0_0_20px_rgba(138,43,226,0.4)]"
            }`}
          >
            {isRecording ? (
               <>
                 <svg className="w-5 h-5 md:w-6 md:h-6 animate-pulse" fill="currentColor" viewBox="0 0 20 20"><rect x="5" y="5" width="10" height="10" rx="2" /></svg>
                 Stop Ordering
               </>
            ) : (
               <>
                 <svg className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4l12 6-12 6z" /></svg>
                 Start Ordering
               </>
            )}
          </button>
        </div>

      </main>

      {/* Footer Link */}
      <div className="absolute bottom-4 z-50">
        <Link href="/order-summary" className="text-text-muted text-xs hover:text-white transition-colors opacity-50 hover:opacity-100">Dev: Order Summary</Link>
      </div>

    </div>
  );
}
