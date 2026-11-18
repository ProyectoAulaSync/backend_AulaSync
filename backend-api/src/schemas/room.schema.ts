import { z } from 'zod';

export const roomNameSchema = z
  .string()
  .trim()
  .min(1, 'El nombre de la sala es obligatorio')
  .max(80, 'El nombre de la sala debe tener máximo 80 caracteres');

export const roomCreateSchema = z.object({
  nombre: roomNameSchema,
});

export const roomUpdateSchema = z.object({
  nombre: roomNameSchema,
});

export const roomIdParamSchema = z.object({
  roomId: z.string().trim().min(1, 'El ID de la sala es obligatorio'),
});

export type RoomCreateInput = z.infer<typeof roomCreateSchema>;
export type RoomUpdateInput = z.infer<typeof roomUpdateSchema>;
