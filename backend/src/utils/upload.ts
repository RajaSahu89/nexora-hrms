import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AppError } from './http';

const EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
export const DOC_MIMES = [...IMAGE_MIMES, 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
export const RESUME_MIMES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

export const uploadPath = (sub: string, name?: string) => path.join(env.uploadDir, sub, name ?? '');

export const makeUpload = (sub: string, mimes: string[], maxMb = env.maxUploadMb) => {
  const dir = uploadPath(sub);
  fs.mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_r, f, cb) => cb(null, crypto.randomBytes(16).toString('hex') + EXT[f.mimetype]),
    }),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (_r, f, cb) => (mimes.includes(f.mimetype) ? cb(null, true) : cb(new AppError(400, 'File type not allowed'))),
  }).single('file');
};

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 4).toString() === '%PDF',
  'image/png': (b) => b[0] === 0x89 && b.subarray(1, 4).toString() === 'PNG',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
  'application/msword': (b) => b[0] === 0xd0 && b[1] === 0xcf,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) => b[0] === 0x50 && b[1] === 0x4b,
};
/** Rejects files whose real content does not match the declared type. */
export const verifyUpload = (req: Request, _res: Response, next: NextFunction) => {
  const f = req.file;
  if (!f) return next();
  try {
    const fd = fs.openSync(f.path, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (!MAGIC[f.mimetype]?.(buf)) {
      fs.unlinkSync(f.path);
      return next(new AppError(400, 'File content does not match its type'));
    }
    next();
  } catch (e) { next(e); }
};
export const removeFile = (p?: string | null) => { if (p) fs.unlink(p, () => {}); };
