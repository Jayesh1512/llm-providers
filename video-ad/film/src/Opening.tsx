import {
  Interactive,
  interpolate,
  Easing,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Frame, PeerMark, type SceneProps } from "./Brand";
const OpeningInner = ({ title, style }: SceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Frame dark chapter="01 / CHOSEN BY YOU" style={style}>
      <Interactive.Div
        name="Opening model line"
        style={{
          position: "absolute",
          left: 140,
          top: 224,
          fontSize: 186,
          lineHeight: 1.06,
          letterSpacing: "-0.07em",
          fontWeight: 700,
          translate: interpolate(
            frame,
            [0, 0.55 * fps],
            ["0px 130px", "0px 0px"],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateRight: "clamp",
            },
          ),
          opacity: interpolate(frame, [0, 0.18 * fps], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        {title}
      </Interactive.Div>
      <Interactive.Div
        name="Opening peer line"
        style={{
          position: "absolute",
          left: 140,
          top: 426,
          fontSize: 186,
          lineHeight: 1.06,
          letterSpacing: "-0.07em",
          fontWeight: 700,
          translate: interpolate(
            frame,
            [0.5 * fps, 1.05 * fps],
            ["0px 130px", "0px 0px"],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
          opacity: interpolate(frame, [0.5 * fps, 0.68 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Your peer.
      </Interactive.Div>
      <Interactive.Div
        name="Opening price line"
        style={{
          position: "absolute",
          left: 140,
          top: 628,
          color: "#c3ee8a",
          fontSize: 186,
          lineHeight: 1.06,
          letterSpacing: "-0.07em",
          fontWeight: 700,
          translate: interpolate(
            frame,
            [1 * fps, 1.55 * fps],
            ["0px 130px", "0px 0px"],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
          opacity: interpolate(frame, [1 * fps, 1.18 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Your price.
      </Interactive.Div>
      <Interactive.Div
        name="Opening network emblem"
        style={{
          position: "absolute",
          left: 1370,
          top: 350,
          width: 310,
          height: 310,
          rotate: interpolate(frame, [0, 4 * fps], ["-8deg", "8deg"], {
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [0, 1.2 * fps], [0.65, 1], {
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
            extrapolateRight: "clamp",
          }),
          opacity: interpolate(frame, [0.8 * fps, 1.3 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div
          style={{
            width: 310,
            height: 310,
            border: "1px solid #537362",
            borderRadius: "50%",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 39,
            top: 39,
            width: 232,
            height: 232,
            border: "1px solid #537362",
            borderRadius: "50%",
          }}
        />
        <div style={{ position: "absolute", left: 65, top: 65 }}>
          <PeerMark size={180} />
        </div>
      </Interactive.Div>
    </Frame>
  );
};
export const Opening = Interactive.withSchema({
  Component: OpeningInner,
  componentName: "<Opening>",
  schema: {
    title: {
      type: "text-content",
      default: "Your model.",
      description: "Opening line",
    },
  },
  wrapInSequence: true,
});
