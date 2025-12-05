import { useAuth } from './hooks/useAuth';
import { useFiles } from './hooks/useFiles';
import { LoginForm } from './components/LoginForm';
import { NewPasswordForm } from './components/NewPasswordForm';
import { Header } from './components/Header';
import { FileUpload } from './components/FileUpload';
import { FileList } from './components/FileList';
import { AuditLogs } from './components/AuditLogs';
import { Loader2 } from 'lucide-react';

function App() {
  const {
    user,
    isAuthenticated,
    isLoading: authLoading,
    error: authError,
    signIn,
    signOut,
    newPasswordRequired,
    pendingEmail,
    submitNewPassword,
  } = useAuth();
  const {
    files,
    isLoading: filesLoading,
    error: filesError,
    nextToken,
    fetchFiles,
    uploadFile,
    downloadFile,
    deleteFile,
    loadMore,
  } = useFiles();

  // Show loading spinner while checking auth
  if (authLoading && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-indigo-500 mx-auto" />
          <p className="mt-4 text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  // Show new password form when Cognito requires password change
  if (newPasswordRequired && pendingEmail) {
    return (
      <NewPasswordForm
        email={pendingEmail}
        isLoading={authLoading}
        error={authError}
        onSubmit={submitNewPassword}
        onCancel={signOut}
      />
    );
  }

  // Show login form if not authenticated
  if (!isAuthenticated || !user) {
    return (
      <LoginForm
        onLogin={signIn}
        error={authError}
        isLoading={authLoading}
      />
    );
  }

  // Show main dashboard
  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} onSignOut={signOut} />

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Upload section */}
          <div className="lg:col-span-1">
            <FileUpload onUpload={uploadFile} />
          </div>

          {/* Files list */}
          <div className="lg:col-span-2">
            <FileList
              files={files}
              isLoading={filesLoading}
              error={filesError}
              onFetch={fetchFiles}
              onDownload={downloadFile}
              onDelete={deleteFile}
              hasMore={!!nextToken}
              onLoadMore={loadMore}
            />
          </div>
        </div>

        {/* Audit logs */}
        <div className="mt-6">
          <AuditLogs />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-5xl mx-auto px-4 py-6 text-center text-sm text-gray-500">
          <p>Compinche File Manager • Serverless Architecture</p>
          <p className="mt-1">AWS Lambda + S3 + DynamoDB + Cognito</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
