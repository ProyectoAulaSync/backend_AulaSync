import type { Request, Response } from 'express';
import { getAuthContext } from '../middlewares/authenticate';
import { profileNotFound } from '../errors/userErrors';
import * as userRepo from '../repositories/user.repository';
import { updateProfileSchema, usernameQuerySchema } from '../schemas/user.schema';

export const checkUsername = async (req: Request, res: Response): Promise<void> => {
  const { username } = usernameQuerySchema.parse(req.query);
  const available = await userRepo.isUsernameAvailable(username.toLowerCase());
  res.json({ username, available });
};

export const getMe = async (_req: Request, res: Response): Promise<void> => {
  const profile = await userRepo.findByUid(getAuthContext(res).uid);
  if (!profile) throw profileNotFound();
  res.json(profile);
};

export const patchMe = async (req: Request, res: Response): Promise<void> => {
  const data = updateProfileSchema.parse(req.body);
  res.json(await userRepo.updateProfile(getAuthContext(res).uid, data));
};
