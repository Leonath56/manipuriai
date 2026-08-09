import React, { useState, useEffect } from 'react';

const statusMessages = [
  "Decoding the Input",
  "Analyzing Meiteilon Context",
  "Parsing Cultural Nuances",
  "Checking Grammar & Tone",
  "Verifying Phrasing & Rules",
  "Synthesizing Meiteilon Response",
  "Polishing Vocabulary",
  "Formatting Response",
  "Finalizing Translation"
];

export const ThinkingLoader = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % statusMessages.length);
        setFade(true);
      }, 200);
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-3 py-2 text-zinc-200 font-medium text-base">
      {/* Animated 3-dot cluster */}
      <div className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce [animation-delay:-0.15s]" />
        <span className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce" />
      </div>
      
      {/* Dynamic Status Text with Beating Animation */}
      <span className={`animate-pulse transition-opacity duration-300 ${fade ? 'opacity-100' : 'opacity-0'}`}>
        {statusMessages[currentIndex]}
      </span>
    </div>
  );
};
