import { useState, useCallback } from 'react';
import {
  listFiles,
  getUploadUrl,
  uploadFileToS3,
  getDownloadUrl,
  deleteFile as apiDeleteFile,
  FileMetadata,
} from '../services/api';
import { config } from '../config';

interface UseFilesReturn {
  files: FileMetadata[];
  isLoading: boolean;
  error: string | null;
  nextToken: string | null;
  fetchFiles: () => Promise<void>;
  uploadFile: (file: File) => Promise<void>;
  downloadFile: (fileId: string) => Promise<void>;
  deleteFile: (fileId: string) => Promise<void>;
  loadMore: () => Promise<void>;
}

export function useFiles(): UseFilesReturn {
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);

  const fetchFiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await listFiles(20);
      setFiles(response.files);
      setNextToken(response.nextToken || null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch files';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextToken || isLoading) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await listFiles(20, nextToken);
      setFiles((prev) => [...prev, ...response.files]);
      setNextToken(response.nextToken || null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load more files';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [nextToken, isLoading]);

  const uploadFile = useCallback(async (file: File) => {
    setError(null);
    
    // Validate file size
    if (file.size > config.upload.maxSizeBytes) {
      throw new Error(`File size exceeds maximum allowed (${config.upload.maxSizeBytes / 1024 / 1024} MB)`);
    }
    
    // Validate MIME type
    if (!config.upload.allowedMimeTypes.includes(file.type)) {
      throw new Error(`File type '${file.type}' is not allowed`);
    }
    
    try {
      // Get presigned URL
      const { presignedUrl } = await getUploadUrl(
        file.name,
        file.type,
        file.size
      );
      
      // Upload to S3
      await uploadFileToS3(presignedUrl, file);
      
      // Refresh file list
      await fetchFiles();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload file';
      setError(message);
      throw err;
    }
  }, [fetchFiles]);

  const downloadFile = useCallback(async (fileId: string) => {
    setError(null);
    
    try {
      const { presignedUrl, fileName } = await getDownloadUrl(fileId);
      
      // Create temporary link and trigger download
      const link = document.createElement('a');
      link.href = presignedUrl;
      link.download = fileName;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to download file';
      setError(message);
      throw err;
    }
  }, []);

  const deleteFile = useCallback(async (fileId: string) => {
    setError(null);
    
    try {
      await apiDeleteFile(fileId);
      
      // Remove from local state
      setFiles((prev) => prev.filter((f) => f.fileId !== fileId));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete file';
      setError(message);
      throw err;
    }
  }, []);

  return {
    files,
    isLoading,
    error,
    nextToken,
    fetchFiles,
    uploadFile,
    downloadFile,
    deleteFile,
    loadMore,
  };
}
