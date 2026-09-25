import type { SceneComponent } from './types';
import { Placeholder } from './Placeholder';
import { openingScenes } from './Opening';
import { featureScenes } from './Features';
import { closingScenes } from './Closing';

// Scene components by the `scene` name in timing.json.
export const SCENES: Record<string, SceneComponent> = { ...openingScenes, ...featureScenes, ...closingScenes };
export const sceneFor = (name: string): SceneComponent => SCENES[name] ?? Placeholder;
