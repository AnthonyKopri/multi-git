import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';

const Placeholder: React.FC = () => <AbsoluteFill style={{background: '#0a0c10'}} />;

export const RemotionRoot: React.FC = () => (
  <Composition id="Placeholder" component={Placeholder} durationInFrames={60} fps={30} width={1920} height={1080} />
);
