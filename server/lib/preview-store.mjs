import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { extractDirectoryData } from './directory-data.mjs';

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export class PreviewStore {
  constructor(root) {
    this.root = root;
    this.dataFile = resolve(root, '.data', 'preview-submissions.json');
    this.collaborationFile = resolve(root, '.data', 'collaboration-requests.json');
    this.photoDir = resolve(root, '.data', 'submission-photos');
  }

  async listDirectory() {
    const { data, offeringsByName } = extractDirectoryData(this.root);
    return data.map((record) => {
      const offerings = offeringsByName[record.name] || { tools: [], services: [] };
      return {
        ...record,
        id: record.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        offerings,
        resources: record.resources || [],
        source: 'preview',
      };
    });
  }

  async findOrganisation(organisationId) {
    return (await this.listDirectory()).find((row) => row.id === organisationId) || null;
  }

  async createSubmission(payload, photo, logo) {
    await mkdir(this.photoDir, { recursive: true });
    const id = randomUUID();
    let photoFile = '';
    let logoFile = '';

    if (photo) {
      photoFile = `${id}-photo.${photo.contentType.split('/')[1]}`;
      await writeFile(resolve(this.photoDir, photoFile), photo.buffer);
    }
    if (logo) {
      logoFile = `${id}-logo.${logo.contentType.split('/')[1]}`;
      await writeFile(resolve(this.photoDir, logoFile), logo.buffer);
    }

    const rows = await readJson(this.dataFile, []);
    rows.push({
      ...payload,
      id,
      reviewStatus: 'Pending',
      submittedAt: new Date().toISOString(),
      photoFile,
      logoFile,
    });

    await mkdir(dirname(this.dataFile), { recursive: true });
    const temporary = `${this.dataFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(rows, null, 2)}\n`);
    await rename(temporary, this.dataFile);
    return { id, table: 'preview-submissions' };
  }

  async createCollaborationRequest(payload) {
    const rows = await readJson(this.collaborationFile, []);
    const request = {
      id: randomUUID(),
      ...payload,
      status: 'Sent',
      submittedAt: new Date().toISOString(),
    };
    rows.push(request);
    await mkdir(dirname(this.collaborationFile), { recursive: true });
    const temporary = `${this.collaborationFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(rows, null, 2)}\n`);
    await rename(temporary, this.collaborationFile);
    return request;
  }

  async health() {
    return { database: 'preview', connected: true };
  }
}
