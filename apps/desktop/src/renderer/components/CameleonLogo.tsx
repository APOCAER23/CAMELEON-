import React from 'react';

interface CameleonLogoProps {
  className?: string;
}

/**
 * Brand chameleon line-art mark adapted to theme colors (uses `currentColor`).
 */
export function CameleonLogo({ className = 'h-5 w-5' }: CameleonLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Curved back sweeping down into the open spiral tail */}
      <path
        d="M 41 35 C 22 41 15 58 20 71 C 25 83 41 85 49 74 C 54 66 49 55 39 54 C 30 53 25 61 28 68 C 30 73 37 74 40 69 C 42 66 39 62 35 63"
        stroke="currentColor"
        strokeWidth="5.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Rounded top crest / horn */}
      <path
        d="M 46 46 L 37 23 C 35.8 18.5 39 16 44 17 C 51 18.5 58 22.5 63 28"
        stroke="currentColor"
        strokeWidth="5.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Forehead, rounded snout & lower jaw */}
      <path
        d="M 49 29 C 65 24 81 34 84 52 C 84.8 56 81.5 60 75 63 C 66 67.5 57 70 49 71"
        stroke="currentColor"
        strokeWidth="5.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Mouth line */}
      <path
        d="M 52 61 L 82 54.5"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* Eye ring */}
      <circle
        cx="64.5"
        cy="43"
        r="8.2"
        stroke="currentColor"
        strokeWidth="5"
      />
      {/* Pupil */}
      <circle cx="64.5" cy="43" r="2.6" fill="currentColor" />
    </svg>
  );
}
