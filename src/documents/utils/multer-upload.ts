import { existsSync, mkdirSync } from 'node:fs';
import { extname } from 'node:path';
import { diskStorage } from 'multer';

export function safeFilename(originalName: string) {
  const base = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(base)}`;
}

export const uploadStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    if (!existsSync(uploadDir)) {
      mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => cb(null, safeFilename(file.originalname)),
});
