/**
 * Application configuration
 * Values come from Vite env vars in production, with sane defaults for local dev.
 */

const COGNITO_USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID || 'us-east-1_gGIEj2gYu';
const COGNITO_USER_POOL_CLIENT_ID = import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID || '1i1e77616ajqqf5ed63vuc6etf';
const COGNITO_REGION = import.meta.env.VITE_COGNITO_REGION || 'us-east-1';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export const config = {
  // AWS Cognito configuration
  cognito: {
    userPoolId: COGNITO_USER_POOL_ID,
    userPoolClientId: COGNITO_USER_POOL_CLIENT_ID,
    region: COGNITO_REGION,
  },
  
  // API Gateway configuration
  api: {
    // In development, calls go through Vite proxy at /api
    baseUrl: API_BASE_URL,
  },
  
  // File upload configuration
  upload: {
    maxSizeBytes: 10 * 1024 * 1024, // 10 MB
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/json',
    ],
  },
};
