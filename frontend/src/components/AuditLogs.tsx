import { useState, useEffect } from 'react';
import { History, RefreshCw, Loader2, X, Eye } from 'lucide-react';
import { getAuditLogs, AuditLog } from '../services/api';

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const fetchLogs = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await getAuditLogs(20);
      setLogs(response.auditLogs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch audit logs');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isExpanded && logs.length === 0) {
      fetchLogs();
    }
  }, [isExpanded]);

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getFileName = (log: AuditLog): string => {
    const metadata = log.metadata as Record<string, unknown> | undefined;
    const nameFromMetadata = (metadata?.fileName as string) || (metadata?.originalName as string);
    return nameFromMetadata || log.fileId;
  };

  const getActionColor = (action: string): string => {
    switch (action) {
      case 'upload':
        return 'bg-green-100 text-green-700';
      case 'download':
        return 'bg-blue-100 text-blue-700';
      case 'delete':
        return 'bg-red-100 text-red-700';
      case 'view':
        return 'bg-purple-100 text-purple-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition"
      >
        <div className="flex items-center gap-3">
          <History className="w-5 h-5 text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900">Audit Logs</h2>
        </div>
        <span className="text-gray-400">{isExpanded ? '▲' : '▼'}</span>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-200">
          <div className="p-4 border-b border-gray-100 flex justify-end">
            <button
              onClick={fetchLogs}
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

          {isLoading && logs.length === 0 ? (
            <div className="p-8 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mx-auto" />
              <p className="mt-2 text-gray-500 text-sm">Loading audit logs...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center">
              <History className="w-10 h-10 text-gray-300 mx-auto" />
              <p className="mt-2 text-gray-500">No audit logs yet</p>
            </div>
          ) : (
            <>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-3 text-left font-medium text-gray-500 w-10" aria-label="Open details" />
                      <th className="px-4 py-3 text-left font-medium text-gray-500">Action</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-500">File Name</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-500">File ID</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-500">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {logs.map((log, index) => (
                      <tr
                        key={`${log.timestamp}-${index}`}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => setSelectedLog(log)}
                      >
                        <td className="px-3 py-3 text-gray-400">
                          <Eye className="w-4 h-4" aria-hidden="true" />
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getActionColor(log.action)}`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-800 truncate max-w-[220px]">
                          {getFileName(log)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600 truncate max-w-[200px]">
                          {log.fileId}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {formatDate(log.timestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedLog && (
                <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 flex flex-col gap-3 mt-1 rounded-b-xl border-l-4 border-l-indigo-400 shadow-inner">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <History className="w-4 h-4 text-indigo-500" />
                      <h3 className="text-sm font-semibold text-gray-800">Log details</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedLog(null)}
                      className="p-1 rounded hover:bg-gray-200 text-gray-500"
                   >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-700">
                    <div>
                      <div className="font-medium text-gray-500">Action</div>
                      <div className={`inline-flex mt-0.5 px-2 py-0.5 rounded-full text-xs font-medium ${getActionColor(selectedLog.action)}`}>
                        {selectedLog.action}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-gray-500">File Name</div>
                      <div className="mt-0.5">{getFileName(selectedLog)}</div>
                    </div>
                    <div>
                      <div className="font-medium text-gray-500">File ID</div>
                      <div className="mt-0.5 font-mono break-all">{selectedLog.fileId}</div>
                    </div>
                    <div>
                      <div className="font-medium text-gray-500">Timestamp</div>
                      <div className="mt-0.5">{formatDate(selectedLog.timestamp)}</div>
                    </div>
                  </div>

                  {selectedLog.metadata && (
                    <div className="mt-2">
                      <div className="text-xs font-medium text-gray-500 mb-1">Metadata</div>
                      <pre className="text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto text-gray-700">
                        {JSON.stringify(selectedLog.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
