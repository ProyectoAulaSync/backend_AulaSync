import { Request, Response, NextFunction } from 'express';
import * as mensajeService from '../services/mensaje.service';

export const getMensaje = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await mensajeService.getMensaje());
  } catch (error) {
    next(error); 
  }
};