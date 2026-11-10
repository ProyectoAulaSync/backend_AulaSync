import { z } from 'zod';
import { avatarSchema, emailSchema, nameSchema, passwordSchema, usernameSchema } from './user.schema';

export const registerSchema = z.object({
  nombres: nameSchema,
  apellidos: nameSchema,
  username: usernameSchema,
  avatar: avatarSchema,
  email: emailSchema,
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
