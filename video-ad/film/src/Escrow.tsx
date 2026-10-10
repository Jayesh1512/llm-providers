import {
  Interactive,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Frame, type SceneProps } from "./Brand";
const EscrowInner = ({ title, style }: SceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Frame chapter="05 / CONSUMER-APPROVED SETTLEMENT" style={style}>
      <Interactive.Div
        name="Escrow headline"
        style={{
          position: "absolute",
          left: 140,
          top: 224,
          fontSize: 123,
          lineHeight: 1,
          fontWeight: 700,
          letterSpacing: "-0.055em",
          translate: interpolate(
            frame,
            [0, 0.5 * fps],
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
      <Interactive.Div
        name="Fund budget step"
        style={{
          position: "absolute",
          left: 140,
          top: 422,
          width: 460,
          opacity: interpolate(frame, [0.25 * fps, 0.65 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div
          style={{
            fontSize: 90,
            fontWeight: 700,
            color: "#236444",
            letterSpacing: "-0.06em",
          }}
        >
          01
        </div>
        <div style={{ fontSize: 44, fontWeight: 700 }}>Fund a budget.</div>
      </Interactive.Div>
      <Interactive.Div
        name="Usage approval step"
        style={{
          position: "absolute",
          left: 710,
          top: 422,
          width: 460,
          opacity: interpolate(frame, [0.9 * fps, 1.3 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div
          style={{
            fontSize: 90,
            fontWeight: 700,
            color: "#236444",
            letterSpacing: "-0.06em",
          }}
        >
          02
        </div>
        <div style={{ fontSize: 44, fontWeight: 700 }}>Approve usage.</div>
      </Interactive.Div>
      <Interactive.Div
        name="Unused credit step"
        style={{
          position: "absolute",
          left: 1275,
          top: 422,
          width: 505,
          opacity: interpolate(frame, [1.6 * fps, 2 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div
          style={{
            fontSize: 90,
            fontWeight: 700,
            color: "#236444",
            letterSpacing: "-0.06em",
          }}
        >
          03
        </div>
        <div style={{ fontSize: 44, fontWeight: 700 }}>Withdraw the rest.</div>
      </Interactive.Div>
      <div
        style={{
          position: "absolute",
          left: 140,
          top: 699,
          width: 1640,
          height: 93,
          backgroundColor: "#e0e7da",
          overflow: "hidden",
        }}
      >
        <Interactive.Div
          name="Approved usage portion"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: interpolate(frame, [2.1 * fps, 2.8 * fps], [0, 1030], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            backgroundColor: "#236444",
            color: "#f5f4ef",
            display: "flex",
            alignItems: "center",
            paddingLeft: 34,
            fontSize: 30,
            whiteSpace: "nowrap",
          }}
        >
          APPROVED CHARGE → SUPPLIER CREDIT
        </Interactive.Div>
        <Interactive.Div
          name="Unused budget portion"
          style={{
            position: "absolute",
            left: 1030,
            top: 0,
            bottom: 0,
            width: 610,
            backgroundColor: "#c3ee8a",
            color: "#202923",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 29,
            opacity: interpolate(frame, [2.6 * fps, 3.2 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          UNUSED → YOUR CREDIT
        </Interactive.Div>
      </div>
      <Interactive.Div
        name="Escrow illustration disclosure"
        style={{
          position: "absolute",
          left: 145,
          top: 836,
          fontSize: 27,
          color: "#59635c",
        }}
      >
        Illustrative split. Unsettled requests can be refunded after expiry.
      </Interactive.Div>
    </Frame>
  );
};
export const Escrow = Interactive.withSchema({
  Component: EscrowInner,
  componentName: "<Escrow>",
  schema: {
    title: {
      type: "text-content",
      default: "Your budget. Your approval.",
      description: "Escrow headline",
    },
  },
  wrapInSequence: true,
});
