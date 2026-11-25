export class AppError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = "AppError";
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Credenciales inválidas") {
    super(message, 401);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "No tienes permiso para realizar esta acción") {
    super(message, 403);
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Recurso no encontrado") {
    super(resource, 404);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message = "Datos de entrada no válidos") {
    super(message, 400);
    this.name = "ValidationError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflicto de datos") {
    super(message, 409);
    this.name = "ConflictError";
  }
}
