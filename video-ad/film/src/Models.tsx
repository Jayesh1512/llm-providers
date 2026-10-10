import {
  Interactive,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Frame, type SceneProps } from "./Brand";
const ModelsInner = ({ title, style }: SceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Frame chapter="02 / PAID APIs · PEER TO PEER" style={style}>
      <Interactive.Div
        name="Model choice headline"
        style={{
          position: "absolute",
          left: 140,
          top: 264,
          width: 720,
          fontSize: 132,
          lineHeight: 1.01,
          fontWeight: 700,
          letterSpacing: "-0.065em",
          translate: interpolate(
            frame,
            [0, 0.65 * fps],
            ["-180px 0px", "0px 0px"],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateRight: "clamp",
            },
          ),
        }}
      >
        {title}
      </Interactive.Div>
      <Interactive.Div
        name="Supplier benefit"
        style={{
          position: "absolute",
          left: 140,
          top: 692,
          width: 625,
          fontSize: 39,
          lineHeight: 1.3,
          color: "#59635c",
          opacity: interpolate(frame, [0.6 * fps, 1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Providers list models.
        <br />
        Set their own rates.
      </Interactive.Div>
      <Interactive.Div
        name="Anthropic API tile"
        style={{
          position: "absolute",
          left: 930,
          top: 250,
          width: 820,
          height: 120,
          border: "1px solid #d7dcd4",
          display: "flex",
          alignItems: "center",
          paddingLeft: 40,
          fontSize: 39,
          color: "#59635c",
          backgroundColor: "#ffffff",
          translate: interpolate(
            frame,
            [0.1 * fps, 0.65 * fps],
            ["200px 0px", "0px 0px"],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
        }}
      >
        01&nbsp;&nbsp; Claude · paid API
      </Interactive.Div>
      <Interactive.Div
        name="OpenAI API tile"
        style={{
          position: "absolute",
          left: 930,
          top: 392,
          width: 820,
          height: 120,
          border: "1px solid #d7dcd4",
          display: "flex",
          alignItems: "center",
          paddingLeft: 40,
          fontSize: 39,
          color: "#59635c",
          backgroundColor: "#ffffff",
          translate: interpolate(
            frame,
            [0.25 * fps, 0.8 * fps],
            ["200px 0px", "0px 0px"],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
        }}
      >
        02&nbsp;&nbsp; OpenAI · paid API
      </Interactive.Div>
      <Interactive.Div
        name="Selected compatible model"
        style={{
          position: "absolute",
          left: 900,
          top: 540,
          width: 880,
          height: 210,
          backgroundColor: "#236444",
          color: "#f5f4ef",
          padding: "36px 44px",
          boxSizing: "border-box",
          translate: interpolate(
            frame,
            [0.45 * fps, 1.05 * fps],
            ["220px 0px", "0px 0px"],
            {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
        }}
      >
        <div
          style={{
            fontSize: 25,
            letterSpacing: "0.08em",
            color: "#c3ee8a",
            marginBottom: 15,
          }}
        >
          03 / COMPATIBLE PAID MODELS
        </div>
        <div
          style={{ fontSize: 58, fontWeight: 700, letterSpacing: "-0.04em" }}
        >
          paid/model-demo&nbsp; ↗
        </div>
      </Interactive.Div>
      <Interactive.Div
        name="Illustrative model disclosure"
        style={{
          position: "absolute",
          left: 934,
          top: 787,
          fontSize: 25,
          color: "#59635c",
        }}
      >
        Illustrative model ID. Configure your available paid models.
      </Interactive.Div>
    </Frame>
  );
};
export const Models = Interactive.withSchema({
  Component: ModelsInner,
  componentName: "<Models>",
  schema: {
    title: {
      type: "text-content",
      default: "Pick your next model.",
      description: "Model choice headline",
    },
  },
  wrapInSequence: true,
});
