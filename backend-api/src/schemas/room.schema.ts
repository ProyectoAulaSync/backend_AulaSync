import { z } from 'zod';
import { nameSchema } from './user.schema';

export const roomCreateSchema = z.object({
  nombre: nameSchema.max(80, 'El nombre de la sala debe tener máximo 80 caracteres'),
});

export const roomUpdateSchema = z.object({
  nombre: nameSchema.max(80, 'El nombre de la sala debe tener máximo 80 caracteres'),
});

export const roomIdParamSchema = z.object({
  roomId: z.string().trim().min(1, 'El ID de la sala es obligatorio'),
});

export type RoomCreateInput = z.infer<typeof roomCreateSchema>;
export type RoomUpdateInput = z.infer<typeof roomUpdateSchema>;
