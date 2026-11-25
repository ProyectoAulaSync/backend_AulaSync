import { z } from 'zod';

export const messageCreateSchema = z.object({
  roomId: z.string().trim().min(1, 'El ID de la sala es obligatorio'),
  texto: z.string().trim().min(1, 'El mensaje no puede estar vacío').max(1000, 'Máximo 1000 caracteres'),
});

export const messageHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().trim().min(1).optional(),
});

export type MessageCreateInput = z.infer<typeof messageCreateSchema>;
export type MessageHistoryQuery = z.infer<typeof messageHistoryQuerySchema>;
