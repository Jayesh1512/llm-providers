import {
  Interactive,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  PrivacyFrame,
  FlowArrow,
  LockMark,
  type PrivacySceneProps,
} from "./PrivacyFrame";

const TEEInputInner = ({ title, style }: PrivacySceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <PrivacyFrame dark chapter="02 / WHY IT MATTERS" style={style}>
      <Interactive.Div
        name="Encrypted input headline"
        style={{
          position: "absolute",
          left: 140,
          top: 242,
          fontSize: 94,
          lineHeight: 1,
          fontWeight: 700,
          letterSpacing: "-0.045em",
          translate: interpolate(
            frame,
            [0, 0.5 * fps],
            ["0px 45px", "0px 0px"],
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
        name="Locked prompt card"
        style={{
          position: "absolute",
          left: 140,
          top: 511,
          width: 460,
          height: 263,
          padding: "33px 34px",
          boxSizing: "border-box",
          border: "1px solid #8bab99",
          backgroundColor: "#173a2c",
          opacity: interpolate(frame, [0.15 * fps, 0.55 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div style={{ position: "absolute", right: 28, top: 28 }}>
          <LockMark size={62} />
        </div>
        <div style={{ fontSize: 28, color: "#c3ee8a" }}>YOUR DEVICE</div>
        <div style={{ fontSize: 47, fontWeight: 700, marginTop: 34 }}>
          Locked prompt
        </div>
        <div style={{ fontSize: 32, marginTop: 17, color: "#acbeb2" }}>
          Encrypted locally
        </div>
      </Interactive.Div>
      <Interactive.Div
        name="Encrypted prompt to relay arrow"
        style={{
          position: "absolute",
          left: 614,
          top: 613,
          opacity: interpolate(frame, [0.55 * fps, 0.85 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <FlowArrow color="#c3ee8a" />
      </Interactive.Div>
      <Interactive.Div
        name="Ciphertext only relay card"
        style={{
          position: "absolute",
          left: 722,
          top: 511,
          width: 460,
          height: 263,
          padding: "33px 34px",
          boxSizing: "border-box",
          border: "1px solid #8bab99",
          backgroundColor: "#173a2c",
          opacity: interpolate(frame, [0.6 * fps, 1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div style={{ fontSize: 28, color: "#c3ee8a" }}>RELAY</div>
        <div style={{ fontSize: 46, fontWeight: 700, marginTop: 34 }}>
          Ciphertext only
        </div>
        <div style={{ fontSize: 32, marginTop: 17, color: "#acbeb2" }}>
          Cannot read the prompt
        </div>
      </Interactive.Div>
      <Interactive.Div
        name="Ciphertext relay to TEE arrow"
        style={{
          position: "absolute",
          left: 1198,
          top: 613,
          opacity: interpolate(frame, [1 * fps, 1.3 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <FlowArrow color="#c3ee8a" />
      </Interactive.Div>
      <Interactive.Div
        name="Lit protected runtime entry card"
        style={{
          position: "absolute",
          left: 1308,
          top: 511,
          width: 472,
          height: 263,
          padding: "33px 34px",
          boxSizing: "border-box",
          border: "1px solid #c3ee8a",
          backgroundColor: "#236444",
          opacity: interpolate(frame, [1.05 * fps, 1.45 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div style={{ fontSize: 28, color: "#c3ee8a" }}>
          PROTECTED DESTINATION
        </div>
        <div style={{ fontSize: 55, fontWeight: 700, marginTop: 30 }}>
          Lit TEE
        </div>
        <div style={{ fontSize: 32, marginTop: 17, color: "#d8e7db" }}>
          Ciphertext enters
        </div>
      </Interactive.Div>
      <Interactive.Div
        name="Relay ciphertext caption"
        style={{
          position: "absolute",
          left: 145,
          top: 838,
          fontSize: 34,
          color: "#acbeb2",
        }}
      >
        Encrypted on your device. Decrypted inside the protected runtime.
      </Interactive.Div>
    </PrivacyFrame>
  );
};
export const TEEInput = Interactive.withSchema({
  Component: TEEInputInner,
  componentName: "<TEEInput>",
  schema: {
    title: {
      type: "text-content",
      default: "Protect prompts from the relay.",
      description: "Encrypted input headline",
    },
  },
  wrapInSequence: true,
});
