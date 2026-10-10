import type React from "react";
import { AbsoluteFill, Interactive } from "remotion";
import "./Brand";

export type PrivacySceneProps = { title: string; style?: React.CSSProperties };

export const LockMark = ({
  color = "#c3ee8a",
  size = 76,
}: {
  color?: string;
  size?: number;
}) => (
  <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
    <path
      d="M25 34V23C25 3 55 3 55 23V34"
      stroke={color}
      strokeWidth="5"
      strokeLinecap="round"
    />
    <rect
      x="15"
      y="34"
      width="50"
      height="37"
      rx="5"
      stroke={color}
      strokeWidth="5"
    />
    <circle cx="40" cy="49" r="4" fill={color} />
    <path d="M40 49V58" stroke={color} strokeWidth="4" />
  </svg>
);

export const FlowArrow = ({ color = "#236444" }: { color?: string }) => (
  <svg width="92" height="60" viewBox="0 0 92 60" fill="none">
    <path
      d="M4 30H83M64 11L83 30L64 49"
      stroke={color}
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const PrivacyFrame = ({
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
      <LockMark size={48} color={dark ? "#c3ee8a" : "#236444"} />
      <Interactive.Div
        name="Lit TEE title"
        style={{ fontSize: 33, fontWeight: 700, letterSpacing: "-0.035em" }}
      >
        Lit TEE
      </Interactive.Div>
    </div>
    <Interactive.Div
      name="Proposed implementation status"
      style={{
        position: "absolute",
        right: 140,
        top: 108,
        fontSize: 27,
        fontWeight: 500,
        color: dark ? "#c3ee8a" : "#236444",
      }}
    >
      Concept • Not live end-to-end
    </Interactive.Div>
    {children}
    <Interactive.Div
      name="Privacy ad chapter label"
      style={{
        position: "absolute",
        left: 140,
        bottom: 94,
        fontSize: 24,
        letterSpacing: "0.05em",
        color: dark ? "#acbeb2" : "#59635c",
      }}
    >
      {chapter}
    </Interactive.Div>
    <Interactive.Div
      name="Proposed Lit flow context"
      style={{
        position: "absolute",
        right: 140,
        bottom: 94,
        fontSize: 24,
        color: dark ? "#acbeb2" : "#59635c",
      }}
    >
      TEE / HARDWARE ISOLATION
    </Interactive.Div>
  </AbsoluteFill>
);
