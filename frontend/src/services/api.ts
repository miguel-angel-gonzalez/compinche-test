import { config } from '../config';
import { getIdToken } from './auth';

const API_BASE = config.api.baseUrl;

/**
 * Make authenticated API request
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getIdToken();
  
  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Types
export interface FileMetadata {
  fileId: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
}

export interface PresignedUploadResponse {
  presignedUrl: string;
  fileId: string;
  s3Key: string;
  expiresIn: number;
}

export interface PresignedDownloadResponse {
  presignedUrl: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  expiresIn: number;
}

export interface ListFilesResponse {
  files: FileMetadata[];
  count: number;
  nextToken?: string;
}

export interface AuditLog {
  userId: string;
  timestamp: string;
  fileId: string;
  action: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogsResponse {
  auditLogs: AuditLog[];
  count: number;
  nextToken?: string;
}

/**
 * Get presigned URL for file upload
 */
export async function getUploadUrl(
  fileName: string,
  contentType: string,
  fileSize: number
): Promise<PresignedUploadResponse> {
  return apiRequest<PresignedUploadResponse>('/files/presigned/upload', {
    method: 'POST',
    body: JSON.stringify({ fileName, contentType, fileSize }),
  });
}

/**
 * Upload file to S3 using presigned URL
 */
export async function uploadFileToS3(
  presignedUrl: string,
  file: File
): Promise<void> {
  const response = await fetch(presignedUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to upload file to S3');
  }
}

/**
 * Get presigned URL for file download
 */
export async function getDownloadUrl(
  fileId: string
): Promise<PresignedDownloadResponse> {
  return apiRequest<PresignedDownloadResponse>('/files/presigned/download', {
    method: 'POST',
    body: JSON.stringify({ fileId }),
  });
}

/**
 * List user files
 */
export async function listFiles(
  limit?: number,
  nextToken?: string
): Promise<ListFilesResponse> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', limit.toString());
  if (nextToken) params.set('nextToken', nextToken);
  
  const query = params.toString();
  return apiRequest<ListFilesResponse>(`/files${query ? `?${query}` : ''}`);
}

/**
 * Delete file
 */
export async function deleteFile(
  fileId: string
): Promise<{ message: string; fileId: string; fileName: string }> {
  return apiRequest('/files/delete', {
    method: 'POST',
    body: JSON.stringify({ fileId }),
  });
}

/**
 * Get audit logs
 *
 * When called without filters, it returns all audit logs for the current user.
 */
export async function getAuditLogs(
  limit?: number,
  startDate?: string,
  endDate?: string,
  nextToken?: string,
  fileId?: string,
  action?: string
): Promise<AuditLogsResponse> {
  const params = new URLSearchParams();
  if (nextToken) params.set('nextToken', nextToken);

  const body: Record<string, unknown> = {};
  if (limit) body.limit = limit;
  if (startDate) body.startDate = startDate;
  if (endDate) body.endDate = endDate;
  if (fileId) body.fileId = fileId;
  if (action) body.action = action;

  const query = params.toString();
  return apiRequest<AuditLogsResponse>(`/files/audit${query ? `?${query}` : ''}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
