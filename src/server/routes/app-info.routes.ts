// Who this application is and which version of it is running.
//
// The version lives in package.json, which the renderer cannot read: it is
// served over HTTP and has no filesystem. Serving it here keeps one source of
// truth for the window title, the browser tab title and anything later that
// wants to show a version.
import { Router } from 'express';

import { APP_DISPLAY_NAME, appTitle, appVersion } from '../app-root';

export const appInfoRouter: Router = Router();

appInfoRouter.get('/api/app-info', (_req, res) => {
  res.json({
    success: true,
    name: APP_DISPLAY_NAME,
    version: appVersion(),
    title: appTitle()
  });
});
