import type { Request, Response } from 'express';
import { getAuthContext } from '../middlewares/authenticate';
import * as messageService from '../services/message.service';
import { messageCreateSchema, messageHistoryQuerySchema } from '../schemas/message.schema';

export const sendMessage = async (req: Request, res: Response): Promise<void> => {
  const roomId = String(req.params.roomId);
  const input = messageCreateSchema.parse({ ...req.body, roomId });
  const uid = getAuthContext(res).uid;
  const autorNombre = await messageService.resolveAutorNombre(uid);
  const mensaje = await messageService.sendMessageService(roomId, input, autorNombre);
  res.status(201).json(mensaje);
};

export const getHistory = async (req: Request, res: Response): Promise<void> => {
  const roomId = String(req.params.roomId);
  const { limit } = messageHistoryQuerySchema.parse(req.query);
  const historial = await messageService.getHistoryService(roomId, limit);
  res.json(historial);
};
