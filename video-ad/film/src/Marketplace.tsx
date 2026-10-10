import {
  Interactive,
  Easing,
  interpolate,
  interpolateColors,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Frame, type SceneProps } from "./Brand";
const MarketplaceInner = ({ title, style }: SceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Frame chapter="03 / COMPARE · THEN CHOOSE" style={style}>
      <Interactive.Div
        name="Comparison headline"
        style={{
          position: "absolute",
          left: 140,
          top: 216,
          fontSize: 112,
          fontWeight: 700,
          letterSpacing: "-0.06em",
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
        name="Price units"
        style={{
          position: "absolute",
          left: 145,
          top: 361,
          fontSize: 29,
          color: "#59635c",
        }}
      >
        Matching peers · paid/model-demo&nbsp; / &nbsp;test MON per 1M tokens
      </Interactive.Div>
      <div
        style={{
          position: "absolute",
          left: 140,
          top: 425,
          width: 1640,
          background: "#ffffff",
          border: "1px solid #d7dcd4",
        }}
      >
        <div
          style={{
            height: 70,
            display: "grid",
            gridTemplateColumns: "650px 350px 350px 290px",
            alignItems: "center",
            fontSize: 25,
            letterSpacing: "0.05em",
            color: "#59635c",
          }}
        >
          <div style={{ paddingLeft: 36 }}>SUPPLIER</div>
          <div style={{ textAlign: "right", paddingRight: 48 }}>INPUT</div>
          <div style={{ textAlign: "right", paddingRight: 48 }}>OUTPUT</div>
          <div style={{ textAlign: "center" }}>YOUR CHOICE</div>
        </div>
        <Interactive.Div
          name="Northline peer offer"
          style={{
            height: 109,
            display: "grid",
            gridTemplateColumns: "650px 350px 350px 290px",
            alignItems: "center",
            borderTop: "1px solid #d7dcd4",
            opacity: interpolate(frame, [0.25 * fps, 0.65 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(
              frame,
              [0.25 * fps, 0.75 * fps],
              ["70px 0px", "0px 0px"],
              {
                easing: Easing.bezier(0.16, 1, 0.3, 1),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            ),
          }}
        >
          <div style={{ paddingLeft: 36, fontSize: 39, fontWeight: 700 }}>
            Northline{" "}
            <span style={{ fontSize: 24, color: "#59635c", fontWeight: 500 }}>
              {" "}
              / peer A
            </span>
          </div>
          <div
            style={{
              textAlign: "right",
              paddingRight: 48,
              fontSize: 54,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            0.08
          </div>
          <div
            style={{
              textAlign: "right",
              paddingRight: 48,
              fontSize: 54,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            0.24
          </div>
          <div style={{ textAlign: "center", color: "#b6c2b4", fontSize: 50 }}>
            ○
          </div>
        </Interactive.Div>
        <Interactive.Div
          name="Cedar peer selected offer"
          style={{
            height: 109,
            display: "grid",
            gridTemplateColumns: "650px 350px 350px 290px",
            alignItems: "center",
            borderTop: "1px solid #d7dcd4",
            backgroundColor: interpolateColors(
              frame,
              [1.7 * fps, 2.1 * fps],
              ["#ffffff", "#ddecce"],
            ),
            opacity: interpolate(frame, [0.45 * fps, 0.85 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(
              frame,
              [0.45 * fps, 0.95 * fps],
              ["70px 0px", "0px 0px"],
              {
                easing: Easing.bezier(0.16, 1, 0.3, 1),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            ),
          }}
        >
          <div style={{ paddingLeft: 36, fontSize: 39, fontWeight: 700 }}>
            Cedar{" "}
            <span style={{ fontSize: 24, color: "#59635c", fontWeight: 500 }}>
              {" "}
              / peer B
            </span>
          </div>
          <div
            style={{
              textAlign: "right",
              paddingRight: 48,
              fontSize: 54,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            0.10
          </div>
          <div
            style={{
              textAlign: "right",
              paddingRight: 48,
              fontSize: 54,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            0.22
          </div>
          <Interactive.Div
            name="Selected supplier marker"
            style={{
              textAlign: "center",
              fontSize: 50,
              color: "#236444",
              opacity: interpolate(frame, [1.7 * fps, 2.1 * fps], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              scale: interpolate(frame, [1.7 * fps, 2.1 * fps], [0.5, 1], {
                easing: Easing.spring({ damping: 200 }),
                output: "perceptual-scale",
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            ●
          </Interactive.Div>
        </Interactive.Div>
        <Interactive.Div
          name="Orbit peer offer"
          style={{
            height: 109,
            display: "grid",
            gridTemplateColumns: "650px 350px 350px 290px",
            alignItems: "center",
            borderTop: "1px solid #d7dcd4",
            opacity: interpolate(frame, [0.65 * fps, 1.05 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(
              frame,
              [0.65 * fps, 1.15 * fps],
              ["70px 0px", "0px 0px"],
              {
                easing: Easing.bezier(0.16, 1, 0.3, 1),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            ),
          }}
        >
          <div style={{ paddingLeft: 36, fontSize: 39, fontWeight: 700 }}>
            Orbit{" "}
            <span style={{ fontSize: 24, color: "#59635c", fontWeight: 500 }}>
              {" "}
              / peer C
            </span>
          </div>
          <div
            style={{
              textAlign: "right",
              paddingRight: 48,
              fontSize: 54,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            0.12
          </div>
          <div
            style={{
              textAlign: "right",
              paddingRight: 48,
              fontSize: 54,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            0.20
          </div>
          <div style={{ textAlign: "center", color: "#b6c2b4", fontSize: 50 }}>
            ○
          </div>
        </Interactive.Div>
      </div>
      <Interactive.Div
        name="Illustrative offers disclosure"
        style={{
          position: "absolute",
          left: 145,
          top: 867,
          fontSize: 27,
          color: "#59635c",
        }}
      >
        Illustrative peers and prices. Live offers come from the on-chain
        registry.
      </Interactive.Div>
    </Frame>
  );
};
export const Marketplace = Interactive.withSchema({
  Component: MarketplaceInner,
  componentName: "<Marketplace>",
  schema: {
    title: {
      type: "text-content",
      default: "Peers. Prices. Your call.",
      description: "Comparison headline",
    },
  },
  wrapInSequence: true,
});
