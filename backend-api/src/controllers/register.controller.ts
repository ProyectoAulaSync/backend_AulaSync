import type { Request, Response } from 'express';
import { registerSchema } from '../schemas/register.schema';
import { registerUser } from '../services/register.service';

export const register = async (req: Request, res: Response): Promise<void> => {
  const input = registerSchema.parse(req.body);
  res.status(201).json(await registerUser(input));
};
