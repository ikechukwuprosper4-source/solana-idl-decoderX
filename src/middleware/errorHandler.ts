import { Request, Response, NextFunction } from "express";
import { ApiResponse } from "../types";
import { logger } from "../utils/logger";

export function notFound(req: Request, res: Response): void {
  const response: ApiResponse = {
    success: false,
    error: "Not Found",
    message: `Route ${req.method} ${req.originalUrl} does not exist`,
    timestamp: new Date().toISOString(),
  };
  res.status(404).json(response);
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  logger.error("Unhandled error", {
    method: req.method,
    url: req.originalUrl,
    error: err.message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });

  const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;

  const response: ApiResponse = {
    success: false,
    error: statusCode === 500 ? "Internal Server Error" : err.name,
    message: err.message,
    timestamp: new Date().toISOString(),
  };

  res.status(statusCode).json(response);
}

/** Wrap an async route handler to forward errors to errorHandler */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

/** Create an HTTP error with a status code */
export function createHttpError(
  statusCode: number,
  message: string
): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}
