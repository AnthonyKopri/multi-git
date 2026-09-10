import { Router } from 'express';
import { browseGithubRepositories } from '../providers/github-repositories';
import { asyncRoute } from '../middleware/error-handler';

export const repositoryBrowserRouter: Router = Router();
repositoryBrowserRouter.get('/api/github/repositories', asyncRoute(async (req, res) => {
  res.json(await browseGithubRepositories(req.query['owner'] ?? ''));
}));
