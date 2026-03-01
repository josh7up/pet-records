import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

@Injectable()
export class LocalStorageService {
  constructor(private readonly config: ConfigService) {}

  getUploadDir() {
    const uploadDir = this.config.get<string>('UPLOAD_DIR', 'uploads');
    if (!existsSync(uploadDir)) {
      mkdirSync(uploadDir, { recursive: true });
    }
    return uploadDir;
  }

  buildAbsolutePath(filename: string) {
    return join(this.getUploadDir(), filename);
  }
}
