import React from 'react';
import { Composition, Folder } from 'remotion';
import { Promo, Promo30, ReadmeGif, Vertical } from './compositions/Film';
import { Showcase } from './compositions/Showcase';
import { defaultPropsFor, promoSchema } from './schema';
import { durationOf, TIMING, type CompositionId } from './timing';

const FILMS: Record<CompositionId, React.FC<any>> = { Promo, Promo30, Vertical, ReadmeGif };

export const RemotionRoot: React.FC = () => (
  <>
    {(Object.keys(FILMS) as CompositionId[]).map((id) => {
      const c = TIMING.compositions[id];
      return (
        <Composition
          key={id}
          id={id}
          component={FILMS[id]}
          schema={promoSchema}
          defaultProps={defaultPropsFor(id)}
          fps={TIMING.fps}
          width={c.width}
          height={c.height}
          durationInFrames={durationOf(id)}
          calculateMetadata={({ props }) => ({ durationInFrames: durationOf(id, props.sceneBars) })}
        />
      );
    })}
    <Folder name="Dev">
      <Composition id="Primitives" component={Showcase} fps={30} width={1920} height={1080} durationInFrames={120} />
    </Folder>
  </>
);
