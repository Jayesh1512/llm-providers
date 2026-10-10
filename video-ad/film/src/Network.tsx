import {
  Interactive,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Frame, PeerMark, type SceneProps } from "./Brand";
const NetworkInner = ({ title, style }: SceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Frame
      dark
      chapter="04 / ON-CHAIN DISCOVERY · DIRECT REQUESTS"
      style={style}
    >
      <Interactive.Div
        name="Direct connection headline"
        style={{
          position: "absolute",
          left: 140,
          top: 222,
          width: 1640,
          fontSize: 92,
          lineHeight: 1.04,
          fontWeight: 700,
          letterSpacing: "-0.055em",
          translate: interpolate(
            frame,
            [0, 0.6 * fps],
            ["0px 80px", "0px 0px"],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateRight: "clamp",
            },
          ),
        }}
      >
        {title}
      </Interactive.Div>
      <svg
        style={{ position: "absolute", left: 0, top: 0 }}
        width="1920"
        height="1080"
        viewBox="0 0 1920 1080"
        fill="none"
      >
        <Interactive.Path
          name="Direct request connection"
          d="M420 575H1500"
          stroke="#c3ee8a"
          strokeWidth="5"
          strokeDasharray="1080"
          style={{
            strokeDashoffset: interpolate(
              frame,
              [0.7 * fps, 1.6 * fps],
              [1080, 0],
              {
                easing: Easing.bezier(0.16, 1, 0.3, 1),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            ),
          }}
        />
        <path
          d="M420 657V805H785M1500 657V805H1135"
          stroke="#567465"
          strokeWidth="2"
          strokeDasharray="8 10"
        />
      </svg>
      <Interactive.Div
        name="Consumer node"
        style={{
          position: "absolute",
          left: 258,
          top: 449,
          width: 325,
          height: 210,
          border: "2px solid #8bab99",
          backgroundColor: "#102c23",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 16,
          scale: interpolate(frame, [0.3 * fps, 0.8 * fps], [0.7, 1], {
            easing: Easing.spring({ damping: 200 }),
            output: "perceptual-scale",
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div style={{ fontSize: 74, color: "#c3ee8a", lineHeight: 1 }}>↗</div>
        <div style={{ fontSize: 37 }}>Consumer</div>
      </Interactive.Div>
      <Interactive.Div
        name="Supplier node"
        style={{
          position: "absolute",
          left: 1336,
          top: 449,
          width: 325,
          height: 210,
          border: "2px solid #c3ee8a",
          backgroundColor: "#236444",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 16,
          scale: interpolate(frame, [0.45 * fps, 0.95 * fps], [0.7, 1], {
            easing: Easing.spring({ damping: 200 }),
            output: "perceptual-scale",
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <PeerMark size={78} />
        <div style={{ fontSize: 37 }}>Your supplier</div>
      </Interactive.Div>
      <Interactive.Div
        name="Prompt packet"
        style={{
          position: "absolute",
          left: 609,
          top: 507,
          padding: "15px 25px",
          backgroundColor: "#c3ee8a",
          color: "#102c23",
          fontSize: 29,
          fontWeight: 700,
          translate: interpolate(
            frame,
            [1.4 * fps, 2.5 * fps, 3.4 * fps],
            ["0px 0px", "345px 0px", "345px 0px"],
            {
              easing: Easing.bezier(0.45, 0, 0.2, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
          opacity: interpolate(
            frame,
            [1.3 * fps, 1.5 * fps, 3.4 * fps, 3.6 * fps],
            [0, 1, 1, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          ),
        }}
      >
        DIRECT PROMPT →
      </Interactive.Div>
      <Interactive.Div
        name="On-chain registry"
        style={{
          position: "absolute",
          left: 785,
          top: 754,
          width: 350,
          height: 99,
          border: "1px solid #8bab99",
          backgroundColor: "#173a2c",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 30,
          color: "#c3ee8a",
          opacity: interpolate(frame, [0.8 * fps, 1.3 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        ON-CHAIN REGISTRY
      </Interactive.Div>
      <Interactive.Div
        name="Provider credential boundary"
        style={{
          position: "absolute",
          left: 606,
          top: 672,
          width: 700,
          textAlign: "center",
          fontSize: 31,
          color: "#acbeb2",
          opacity: interpolate(frame, [1.7 * fps, 2.3 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        API keys stay with the provider.
      </Interactive.Div>
    </Frame>
  );
};
export const Network = Interactive.withSchema({
  Component: NetworkInner,
  componentName: "<Network>",
  schema: {
    title: {
      type: "text-content",
      default: "Discover on-chain. Connect directly.",
      description: "Direct connection headline",
    },
  },
  wrapInSequence: true,
});
