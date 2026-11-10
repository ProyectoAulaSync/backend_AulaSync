import type { Request, Response } from 'express';
import { getAuthContext } from '../middlewares/authenticate';
import * as userRepo from '../repositories/user.repository';
import { chooseUsernameSchema } from '../schemas/user.schema';
import { syncGoogleUser } from '../services/google.service';

export const syncGoogle = async (_req: Request, res: Response): Promise<void> => {
  res.json(await syncGoogleUser(getAuthContext(res)));
};

export const chooseUsername = async (req: Request, res: Response): Promise<void> => {
  const { username } = chooseUsernameSchema.parse(req.body);
  res.json(await userRepo.setUsername(getAuthContext(res).uid, username));
};
