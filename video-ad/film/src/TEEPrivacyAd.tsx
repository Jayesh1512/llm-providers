import {
  AbsoluteFill,
  Composition,
  Folder,
  Series,
  useVideoConfig,
} from "remotion";
import { TEEInput } from "./TEEInput";
import { TEEAction } from "./TEEAction";
import { TEEUpstream } from "./TEEUpstream";

export const TEEPrivacyAd = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Series>
        <Series.Sequence
          name="Define a hardware protected room"
          durationInFrames={5 * fps}
          premountFor={fps}
        >
          <TEEAction
            title="TEE = Trusted Execution Environment"
            premountFor={fps}
          />
        </Series.Sequence>
        <Series.Sequence
          name="Explain why relay privacy matters"
          durationInFrames={4 * fps}
          premountFor={fps}
        >
          <TEEInput title="Protect prompts from the relay." premountFor={fps} />
        </Series.Sequence>
        <Series.Sequence
          name="Proposed Lit implementation and pending verification"
          durationInFrames={6 * fps}
          premountFor={fps}
        >
          <TEEUpstream title="Our proposed Lit flow" premountFor={fps} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};

export const TEEPrivacyCompositions = () => (
  <>
    <Composition
      id="TEEPrivacyAd"
      component={TEEPrivacyAd}
      durationInFrames={450}
      fps={30}
      width={1920}
      height={1080}
    />
    <Folder name="TEE-Scenes">
      <Composition
        id="TEEAction"
        component={TEEAction}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ title: "TEE = Trusted Execution Environment" }}
      />
      <Composition
        id="TEEInput"
        component={TEEInput}
        durationInFrames={120}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ title: "Protect prompts from the relay." }}
      />
      <Composition
        id="TEEUpstream"
        component={TEEUpstream}
        durationInFrames={180}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ title: "Our proposed Lit flow" }}
      />
    </Folder>
  </>
);
