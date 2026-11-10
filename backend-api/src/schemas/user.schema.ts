import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'El nombre de usuario debe tener entre 3 y 20 caracteres')
  .max(20, 'El nombre de usuario debe tener entre 3 y 20 caracteres')
  .regex(/^[A-Za-z0-9_]+$/, 'Usa solo letras, números y guion bajo (_)');

export const nameSchema = z.string().trim().min(1, 'Este campo es obligatorio').max(60, 'Máximo 60 caracteres');

export const avatarSchema = z.string().trim().min(1, 'Elige un avatar').max(60, 'Avatar no válido');

export const emailSchema = z.string().trim().toLowerCase().email('Escribe un correo válido');

export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(128, 'La contraseña es demasiado larga')
  .regex(/[A-Za-z]/, 'Incluye al menos una letra')
  .regex(/\d/, 'Incluye al menos un número');

export const usernameQuerySchema = z.object({ username: usernameSchema });
export const chooseUsernameSchema = z.object({ username: usernameSchema });

export const updateProfileSchema = z
  .object({
    nombres: nameSchema.optional(),
    apellidos: nameSchema.optional(),
    avatar: avatarSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'Envía al menos un campo para actualizar');
