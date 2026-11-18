export interface AppErrorOptions {
  code?: string;
  field?: string;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string | undefined;
  public readonly field: string | undefined;

  constructor(message: string, statusCode = 500, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = options.code;
    this.field = options.field;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
