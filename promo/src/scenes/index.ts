import type { SceneComponent } from './types';
import { Placeholder } from './Placeholder';

// Scene components by the `scene` name in timing.json.
export const SCENES: Record<string, SceneComponent> = {};
export const sceneFor = (name: string): SceneComponent => SCENES[name] ?? Placeholder;
