import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
  console.error('[Error]:', err);
  
  const appError = err instanceof AppError ? err : new AppError('Error interno del servidor', 500);

  // Respuesta JSON genérica sin exponer la traza al cliente
  res.status(appError.statusCode).json({
    status: 'error',
    statusCode: appError.statusCode,
    message: appError.message
  });
};