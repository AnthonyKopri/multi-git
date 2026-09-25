import {Config} from '@remotion/cli/config';

Config.setEntryPoint('src/index.ts');
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
// On the owner's PC this stays null, so Remotion uses its own Chrome Headless
// Shell. In a locked-down container, point REMOTION_BROWSER at any Chromium.
Config.setBrowserExecutable(process.env.REMOTION_BROWSER ?? null);
