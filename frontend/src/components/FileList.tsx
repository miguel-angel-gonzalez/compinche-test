import { useEffect } from 'react';
import { FileIcon, Download, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { FileMetadata } from '../services/api';

interface FileListProps {
  files: FileMetadata[];
  isLoading: boolean;
  error: string | null;
  onFetch: () => Promise<void>;
  onDownload: (fileId: string) => Promise<void>;
  onDelete: (fileId: string) => Promise<void>;
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
}

export function FileList({
  files,
  isLoading,
  error,
  onFetch,
  onDownload,
  onDelete,
  hasMore,
  onLoadMore,
}: FileListProps) {
  useEffect(() => {
    onFetch();
  }, []);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getFileIcon = (contentType: string) => {
    if (contentType.startsWith('image/')) {
      return '🖼️';
    }
    if (contentType === 'application/pdf') {
      return '📄';
    }
    if (contentType.includes('word') || contentType.includes('document')) {
      return '📝';
    }
    if (contentType === 'application/json') {
      return '📋';
    }
    return '📁';
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Your Files</h2>
        <button
          onClick={onFetch}
          disabled={isLoading}
          className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
        >
          <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 text-sm">
          {error}
        </div>
      )}

      {isLoading && files.length === 0 ? (
        <div className="p-12 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mx-auto" />
          <p className="mt-2 text-gray-500">Loading files...</p>
        </div>
      ) : files.length === 0 ? (
        <div className="p-12 text-center">
          <FileIcon className="w-12 h-12 text-gray-300 mx-auto" />
          <p className="mt-2 text-gray-500">No files uploaded yet</p>
          <p className="text-sm text-gray-400">Upload your first file to get started</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-gray-100">
            {files.map((file) => (
              <div
                key={file.fileId}
                className="p-4 hover:bg-gray-50 transition flex items-center justify-between"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <span className="text-2xl">{getFileIcon(file.contentType)}</span>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{file.fileName}</p>
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      <span>{formatFileSize(file.fileSize)}</span>
                      <span>•</span>
                      <span>{formatDate(file.createdAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => onDownload(file.fileId)}
                    className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                    title="Download"
                  >
                    <Download className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this file?')) {
                        onDelete(file.fileId);
                      }
                    }}
                    className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                    title="Delete"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <div className="p-4 border-t border-gray-200">
              <button
                onClick={onLoadMore}
                disabled={isLoading}
                className="w-full py-2 text-indigo-600 hover:bg-indigo-50 rounded-lg font-medium transition disabled:opacity-50"
              >
                {isLoading ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
