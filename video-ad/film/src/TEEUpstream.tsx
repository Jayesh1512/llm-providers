import {
  Interactive,
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

const TEEUpstreamInner = ({ title, style }: PrivacySceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const appear = (delay: number) =>
    interpolate(frame, [delay * fps, (delay + 0.3) * fps], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  return (
    <PrivacyFrame dark chapter="03 / OUR IMPLEMENTATION STATUS" style={style}>
      <Interactive.Div
        name="Proposed Lit flow headline"
        style={{
          position: "absolute",
          left: 140,
          top: 236,
          fontSize: 113,
          fontWeight: 700,
          letterSpacing: "-0.04em",
        }}
      >
        {title}
      </Interactive.Div>
      <Interactive.Div
        name="Consumer encrypted input and reply"
        style={{
          position: "absolute",
          left: 140,
          top: 470,
          width: 405,
          height: 289,
          padding: "30px 32px",
          border: "1px solid #8bab99",
          backgroundColor: "#173a2c",
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontSize: 28, color: "#c3ee8a" }}>YOUR DEVICE</div>
        <div style={{ marginTop: 28 }}>
          <LockMark size={66} />
        </div>
        <div style={{ fontSize: 38, fontWeight: 700, marginTop: 19 }}>
          Encrypt / decrypt
        </div>
      </Interactive.Div>
      <Interactive.Div
        name="Encrypted prompt to Lit Action"
        style={{
          position: "absolute",
          left: 568,
          top: 491,
          width: 236,
          opacity: appear(0.25),
        }}
      >
        <div style={{ fontSize: 27, color: "#d8e7db", marginBottom: 4 }}>
          Encrypted prompt
        </div>
        <div style={{ marginLeft: 59 }}>
          <FlowArrow color="#c3ee8a" />
        </div>
      </Interactive.Div>
      <Interactive.Div
        name="Protected Lit Action"
        style={{
          position: "absolute",
          left: 820,
          top: 470,
          width: 510,
          height: 289,
          padding: "28px 31px",
          border: "1px solid #c3ee8a",
          backgroundColor: "#236444",
          boxSizing: "border-box",
          opacity: appear(0.25),
        }}
      >
        <div style={{ fontSize: 26, color: "#c3ee8a" }}>
          PROTECTED LIT RUNTIME
        </div>
        <div style={{ fontSize: 55, fontWeight: 700, marginTop: 32 }}>
          Lit Action
        </div>
        <div style={{ fontSize: 33, color: "#d8e7db", marginTop: 22 }}>
          Decrypts • calls LLM
        </div>
        <div style={{ fontSize: 33, color: "#d8e7db", marginTop: 9 }}>
          Encrypts the answer
        </div>
      </Interactive.Div>
      <Interactive.Div
        name="External paid API call"
        style={{
          position: "absolute",
          left: 1356,
          top: 548,
          opacity: appear(0.65),
        }}
      >
        <div style={{ fontSize: 22, color: "#acbeb2", marginBottom: 8 }}>
          API CALL
        </div>
        <FlowArrow color="#c3ee8a" />
      </Interactive.Div>
      <Interactive.Div
        name="External upstream model outside TEE"
        style={{
          position: "absolute",
          left: 1473,
          top: 470,
          width: 307,
          height: 289,
          padding: "30px 25px",
          border: "1px solid #8bab99",
          boxSizing: "border-box",
          opacity: appear(0.65),
        }}
      >
        <div style={{ fontSize: 26, color: "#acbeb2" }}>OUTSIDE TEE</div>
        <div style={{ fontSize: 43, fontWeight: 700, marginTop: 34 }}>
          Upstream
        </div>
        <div style={{ fontSize: 54, fontWeight: 700, marginTop: 2 }}>LLM</div>
        <div style={{ fontSize: 28, color: "#acbeb2", marginTop: 14 }}>
          Paid API
        </div>
      </Interactive.Div>
      <Interactive.Div
        name="Encrypted answer back to device"
        style={{
          position: "absolute",
          left: 568,
          top: 642,
          width: 236,
          opacity: appear(1.15),
        }}
      >
        <div style={{ rotate: "180deg", width: 92, marginLeft: 59 }}>
          <FlowArrow color="#c3ee8a" />
        </div>
        <div style={{ fontSize: 27, color: "#d8e7db", marginTop: 4 }}>
          Encrypted answer
        </div>
      </Interactive.Div>
      <Interactive.Div
        name="Upstream plaintext disclosure"
        style={{
          position: "absolute",
          left: 145,
          top: 803,
          fontSize: 34,
          color: "#acbeb2",
        }}
      >
        Upstream LLM receives the prompt.
      </Interactive.Div>
      <Interactive.Div
        name="Code built verification pending status"
        style={{
          position: "absolute",
          left: 145,
          top: 872,
          fontSize: 34,
          color: "#c3ee8a",
          opacity: appear(1.35),
        }}
      >
        Code built. Hardware-to-Action/key verification pending.
      </Interactive.Div>
    </PrivacyFrame>
  );
};
export const TEEUpstream = Interactive.withSchema({
  Component: TEEUpstreamInner,
  componentName: "<TEEUpstream>",
  schema: {
    title: {
      type: "text-content",
      default: "Our proposed Lit flow",
      description: "Proposed Lit implementation headline",
    },
  },
  wrapInSequence: true,
});
