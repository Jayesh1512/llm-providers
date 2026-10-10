import { Audio } from "@remotion/media";
import {
  AbsoluteFill,
  Composition,
  Folder,
  Series,
  staticFile,
  useVideoConfig,
} from "remotion";
import { Opening } from "./Opening";
import { Models } from "./Models";
import { Marketplace } from "./Marketplace";
import { Network } from "./Network";
import { Escrow } from "./Escrow";
import { Closing } from "./Closing";
import { TEEPrivacyCompositions } from "./TEEPrivacyAd";
export const LaunchAd = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Audio
        name="Original electronic score"
        src={staticFile("original-score.wav")}
        durationInFrames={30 * fps}
        premountFor={fps}
      />
      <Series>
        <Series.Sequence
          name="Your model. Your peer. Your price."
          durationInFrames={4 * fps}
          premountFor={fps}
        >
          <Opening title="Your model." premountFor={fps} />
        </Series.Sequence>
        <Series.Sequence
          name="Choose your paid model"
          durationInFrames={4 * fps}
          premountFor={fps}
        >
          <Models title="Pick your next model." premountFor={fps} />
        </Series.Sequence>
        <Series.Sequence
          name="Compare matching peers and prices"
          durationInFrames={6 * fps}
          premountFor={fps}
        >
          <Marketplace title="Peers. Prices. Your call." premountFor={fps} />
        </Series.Sequence>
        <Series.Sequence
          name="On-chain discovery, direct request"
          durationInFrames={5 * fps}
          premountFor={fps}
        >
          <Network
            title="Discover on-chain. Connect directly."
            premountFor={fps}
          />
        </Series.Sequence>
        <Series.Sequence
          name="Consumer-approved escrow"
          durationInFrames={5 * fps}
          premountFor={fps}
        >
          <Escrow title="Your budget. Your approval." premountFor={fps} />
        </Series.Sequence>
        <Series.Sequence
          name="Try the Monad testnet MVP"
          durationInFrames={6 * fps}
          premountFor={fps}
        >
          <Closing title="LLM Providers" premountFor={fps} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
export const MyComposition = () => (
  <>
    <Composition
      id="LLMProvidersAd"
      component={LaunchAd}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
    />
    <TEEPrivacyCompositions />
    <Folder name="Scenes">
      <Composition
        id="Opening"
        component={Opening}
        durationInFrames={120}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ title: "Your model." }}
      />
      <Composition
        id="Models"
        component={Models}
        durationInFrames={120}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ title: "Pick your next model." }}
      />
      <Composition
        id="Marketplace"
        component={Marketplace}
        durationInFrames={180}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ title: "Peers. Prices. Your call." }}
      />
      <Composition
        id="Network"
        component={Network}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ title: "Discover on-chain. Connect directly." }}
      />
      <Composition
        id="Escrow"
        component={Escrow}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ title: "Your budget. Your approval." }}
      />
      <Composition
        id="Closing"
        component={Closing}
        durationInFrames={180}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ title: "LLM Providers" }}
      />
    </Folder>
  </>
);
