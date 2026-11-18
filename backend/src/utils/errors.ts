// Compatibility layer: one error class and one asyncHandler shared by every module.
export { AppError as ApiError, asyncHandler } from './http';
