import { z } from 'zod';

export const messageCreateSchema = z.object({
  roomId: z.string().trim().min(1, 'El ID de la sala es obligatorio'),
  texto: z.string().trim().min(1, 'El mensaje no puede estar vacío').max(1000, 'Máximo 1000 caracteres'),
});

export const messageHistoryQuerySchema = z.object({
  roomId: z.string().trim().min(1, 'El ID de la sala es obligatorio'),
  limit: z.coerce.number().min(1).max(100).default(50).optional(),
});

export type MessageCreateInput = z.infer<typeof messageCreateSchema>;
