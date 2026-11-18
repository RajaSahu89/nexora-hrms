import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from '../config/env';
import { ApiError } from '../utils/errors';

const IMG = { exts: ['.jpg', '.jpeg', '.png', '.webp'], mimes: ['image/jpeg', 'image/png', 'image/webp'] };
const DOC = {
  exts: ['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx'],
  mimes: ['application/pdf', 'image/png', 'image/jpeg', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};
const RESUME = { exts: ['.pdf', '.doc', '.docx'], mimes: DOC.mimes.filter((m) => !m.startsWith('image')) };

function make(sub: string, t: { exts: string[]; mimes: string[] }) {
  const dir = path.join(env.uploadDir, sub);
  fs.mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: (_r, _f, cb) => cb(null, dir),
      filename: (_r, f, cb) => cb(null, crypto.randomUUID() + path.extname(f.originalname).toLowerCase()),
    }),
    limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
    fileFilter: (_r, f, cb) => {
      const ext = path.extname(f.originalname).toLowerCase();
      if (t.exts.includes(ext) && t.mimes.includes(f.mimetype)) cb(null, true);
      else cb(new ApiError(400, `Invalid file type. Allowed: ${t.exts.join(', ')}`) as any);
    },
  });
}
export const photoUpload = make('employees', IMG);
export const logoUpload = make('company', IMG);
export const docUpload = make('documents', DOC);
export const resumeUpload = make('resumes', RESUME);
export const uploadPath = (sub: string, file: string) => path.join(env.uploadDir, sub, path.basename(file));
