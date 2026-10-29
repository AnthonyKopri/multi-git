import { Router } from 'express';
import { browseGithubRepositories } from '../providers/github-repositories';

export const repositoryBrowserRouter: Router = Router();
repositoryBrowserRouter.get('/api/github/repositories', async (req, res) => {
  res.json(await browseGithubRepositories(req.query['owner'] ?? ''));
});
