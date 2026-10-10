import {
  Interactive,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Frame, PeerMark, type SceneProps } from "./Brand";
const ClosingInner = ({ title, style }: SceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Frame dark chapter="06 / PAID API ACCESS · PEER TO PEER" style={style}>
      <Interactive.Div
        name="Closing peer mark"
        style={{
          position: "absolute",
          left: 139,
          top: 244,
          scale: interpolate(frame, [0, 0.8 * fps], [0.55, 1], {
            easing: Easing.spring({ damping: 200 }),
            output: "perceptual-scale",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <PeerMark size={128} />
      </Interactive.Div>
      <Interactive.Div
        name="Closing product title"
        style={{
          position: "absolute",
          left: 137,
          top: 412,
          fontSize: 174,
          lineHeight: 1,
          fontWeight: 700,
          letterSpacing: "-0.065em",
          translate: interpolate(
            frame,
            [0.3 * fps, 0.9 * fps],
            ["0px 110px", "0px 0px"],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
          opacity: interpolate(frame, [0.3 * fps, 0.65 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {title}
      </Interactive.Div>
      <Interactive.Div
        name="Two-sided marketplace value"
        style={{
          position: "absolute",
          left: 146,
          top: 623,
          fontSize: 53,
          color: "#acbeb2",
          letterSpacing: "-0.025em",
          opacity: interpolate(frame, [0.7 * fps, 1.1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Find access. Offer capacity.
      </Interactive.Div>
      <Interactive.Div
        name="Testnet call to action"
        style={{
          position: "absolute",
          left: 140,
          top: 744,
          padding: "27px 40px",
          color: "#102c23",
          backgroundColor: "#c3ee8a",
          fontSize: 39,
          fontWeight: 700,
          translate: interpolate(
            frame,
            [1.1 * fps, 1.65 * fps],
            ["0px 65px", "0px 0px"],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
          opacity: interpolate(frame, [1.1 * fps, 1.45 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Try the Monad testnet MVP&nbsp;&nbsp; ↗
      </Interactive.Div>
      <Interactive.Div
        name="Closing motion accent"
        style={{
          position: "absolute",
          left: 1550,
          top: 282,
          width: 350,
          height: 350,
          border: "1px solid #547360",
          borderRadius: "50%",
          scale: interpolate(frame, [0, 6 * fps], [0.8, 1.5], {
            output: "perceptual-scale",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 62,
            top: 62,
            width: 222,
            height: 222,
            border: "1px solid #547360",
            borderRadius: "50%",
          }}
        />
      </Interactive.Div>
    </Frame>
  );
};
export const Closing = Interactive.withSchema({
  Component: ClosingInner,
  componentName: "<Closing>",
  schema: {
    title: {
      type: "text-content",
      default: "LLM Providers",
      description: "Closing product title",
    },
  },
  wrapInSequence: true,
});
