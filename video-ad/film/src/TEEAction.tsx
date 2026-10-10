import {
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { PrivacyFrame, LockMark, type PrivacySceneProps } from "./PrivacyFrame";

const TEEActionInner = ({ title, style }: PrivacySceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const appear = (delay: number) =>
    interpolate(frame, [delay * fps, (delay + 0.35) * fps], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  return (
    <PrivacyFrame chapter="01 / WHAT IS A TEE?" style={style}>
      <Interactive.Div
        name="TEE full definition"
        style={{
          position: "absolute",
          left: 140,
          top: 230,
          fontSize: 81,
          fontWeight: 700,
          letterSpacing: "-0.04em",
        }}
      >
        {title}
      </Interactive.Div>
      <Interactive.Div
        name="Plain language TEE definition"
        style={{
          position: "absolute",
          left: 145,
          top: 345,
          fontSize: 55,
          color: "#59635c",
        }}
      >
        A hardware-protected room inside a server.
      </Interactive.Div>
      <Interactive.Div
        name="Server hardware outline"
        style={{
          position: "absolute",
          left: 640,
          top: 469,
          width: 1140,
          height: 370,
          border: "2px solid #a8b6ab",
          backgroundColor: "#e8ece4",
          boxSizing: "border-box",
          opacity: appear(0.2),
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 35,
            top: 22,
            fontSize: 27,
            color: "#59635c",
          }}
        >
          SERVER
        </div>
        <Interactive.Div
          name="Hardware enforced protected room"
          style={{
            position: "absolute",
            left: 108,
            top: 83,
            width: 928,
            height: 245,
            backgroundColor: "#236444",
            color: "#f5f4ef",
            padding: "27px 34px",
            boxSizing: "border-box",
          }}
        >
          <div style={{ position: "absolute", right: 30, top: 27 }}>
            <LockMark size={70} />
          </div>
          <div style={{ fontSize: 29, color: "#c3ee8a" }}>
            HARDWARE-ENFORCED BOUNDARY
          </div>
          <div style={{ fontSize: 53, fontWeight: 700, marginTop: 21 }}>
            Protected room
          </div>
          <div style={{ fontSize: 36, marginTop: 12, color: "#d8e7db" }}>
            Program + data inside
          </div>
        </Interactive.Div>
      </Interactive.Div>
      <Interactive.Div
        name="Host operator outside protected room"
        style={{
          position: "absolute",
          left: 140,
          top: 511,
          width: 355,
          textAlign: "center",
          opacity: appear(0.55),
        }}
      >
        <svg width="110" height="110" viewBox="0 0 110 110" fill="none">
          <circle cx="55" cy="29" r="19" stroke="#59635c" strokeWidth="5" />
          <path
            d="M19 97V82C19 43 91 43 91 82V97"
            stroke="#59635c"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </svg>
        <div style={{ fontSize: 38, fontWeight: 700, marginTop: 10 }}>
          Host operator
        </div>
        <div style={{ fontSize: 28, color: "#59635c", marginTop: 10 }}>
          Attempts to inspect
        </div>
      </Interactive.Div>
      <Interactive.Div
        name="Host inspection blocked at boundary"
        style={{
          position: "absolute",
          left: 493,
          top: 609,
          opacity: appear(1.3),
        }}
      >
        <svg width="228" height="74" viewBox="0 0 228 74" fill="none">
          <path
            d="M3 37H197M175 17L197 37L175 57"
            stroke="#59635c"
            strokeWidth="4"
            strokeDasharray="10 8"
          />
          <circle
            cx="199"
            cy="37"
            r="31"
            fill="#f5f4ef"
            stroke="#236444"
            strokeWidth="4"
          />
          <path d="M181 55L217 19" stroke="#236444" strokeWidth="5" />
        </svg>
        <div
          style={{
            fontSize: 26,
            color: "#236444",
            marginTop: 11,
            marginLeft: 5,
          }}
        >
          Access restricted
        </div>
      </Interactive.Div>
      <Interactive.Div
        name="Qualified host isolation explanation"
        style={{
          position: "absolute",
          left: 145,
          top: 878,
          fontSize: 39,
          color: "#59635c",
        }}
      >
        Designed to restrict host access.
      </Interactive.Div>
    </PrivacyFrame>
  );
};
export const TEEAction = Interactive.withSchema({
  Component: TEEActionInner,
  componentName: "<TEEAction>",
  schema: {
    title: {
      type: "text-content",
      default: "TEE = Trusted Execution Environment",
      description: "TEE definition headline",
    },
  },
  wrapInSequence: true,
});
