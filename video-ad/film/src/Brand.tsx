import type React from "react";
import { loadFont } from "@remotion/fonts";
import { AbsoluteFill, Interactive, staticFile } from "remotion";

void loadFont({
  family: "DM Sans",
  url: staticFile("dm-sans-latin-500-normal.woff2"),
  weight: "500",
});
void loadFont({
  family: "DM Sans",
  url: staticFile("dm-sans-latin-700-normal.woff2"),
  weight: "700",
});
export type SceneProps = { title: string; style?: React.CSSProperties };
export const PeerMark = ({
  color = "#c3ee8a",
  size = 64,
}: {
  color?: string;
  size?: number;
}) => (
  <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
    <path
      d="M18 60L40 20L62 60M18 60H62M40 20V60"
      stroke={color}
      strokeWidth="6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="18" cy="60" r="8" fill={color} />
    <circle cx="40" cy="20" r="8" fill={color} />
    <circle cx="62" cy="60" r="8" fill={color} />
  </svg>
);
export const Frame = ({
  children,
  dark = false,
  chapter,
  style,
}: {
  children: React.ReactNode;
  dark?: boolean;
  chapter: string;
  style?: React.CSSProperties;
}) => (
  <AbsoluteFill
    style={{
      backgroundColor: dark ? "#102c23" : "#f5f4ef",
      color: dark ? "#f5f4ef" : "#202923",
      fontFamily: "DM Sans",
      overflow: "hidden",
      ...style,
    }}
  >
    <div
      style={{
        position: "absolute",
        left: 76,
        top: 58,
        right: 76,
        bottom: 58,
        border: dark ? "1px solid #385348" : "1px solid #d7dcd4",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 136,
        top: 94,
        display: "flex",
        alignItems: "center",
        gap: 17,
      }}
    >
      <PeerMark size={48} color={dark ? "#c3ee8a" : "#236444"} />
      <Interactive.Div
        name="Product brand"
        style={{ fontSize: 33, fontWeight: 700, letterSpacing: "-0.04em" }}
      >
        LLM Providers
      </Interactive.Div>
    </div>
    <Interactive.Div
      name="Network context"
      style={{
        position: "absolute",
        right: 140,
        top: 109,
        fontSize: 23,
        fontWeight: 500,
        letterSpacing: "0.03em",
        color: dark ? "#c3ee8a" : "#236444",
      }}
    >
      MONAD TESTNET · 10143
    </Interactive.Div>
    {children}
    <Interactive.Div
      name="Chapter label"
      style={{
        position: "absolute",
        left: 140,
        bottom: 94,
        fontSize: 23,
        letterSpacing: "0.08em",
        color: dark ? "#acbeb2" : "#59635c",
      }}
    >
      {chapter}
    </Interactive.Div>
    <div
      style={{
        position: "absolute",
        right: 140,
        bottom: 94,
        display: "flex",
        gap: 12,
      }}
    >
      <div
        style={{
          height: 9,
          width: 48,
          background: dark ? "#c3ee8a" : "#236444",
        }}
      />
      <div
        style={{
          height: 9,
          width: 9,
          background: dark ? "#537362" : "#c4cfbf",
        }}
      />
      <div
        style={{
          height: 9,
          width: 9,
          background: dark ? "#537362" : "#c4cfbf",
        }}
      />
    </div>
  </AbsoluteFill>
);
