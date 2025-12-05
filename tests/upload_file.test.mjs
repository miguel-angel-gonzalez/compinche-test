/**
 * Unit tests for upload_file Lambda
 */

import { jest } from '@jest/globals';

// Mock AWS SDK clients
const mockGetSignedUrl = jest.fn();
const mockSend = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({})),
  PutObjectCommand: jest.fn((params) => params),
}));

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.unstable_mockModule('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  PutCommand: jest.fn((params) => params),
}));

jest.unstable_mockModule('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

// Import handler after mocking
const { handler } = await import('../backend/lambdas/upload_file.mjs');

describe('Upload File Lambda', () => {
  const mockUserId = 'test-user-123';
  
  const createEvent = (body, userId = mockUserId) => ({
    requestContext: {
      authorizer: {
        claims: { sub: userId },
      },
    },
    body: JSON.stringify(body),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSignedUrl.mockResolvedValue('https://s3.presigned.url/test');
    mockSend.mockResolvedValue({});
  });

  describe('Authentication', () => {
    it('should return 401 when userId is not present', async () => {
      const event = {
        requestContext: {},
        body: JSON.stringify({ fileName: 'test.pdf', contentType: 'application/pdf', fileSize: 1000 }),
      };

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(401);
      expect(body.error).toContain('Unauthorized');
    });

    it('should return 401 when authorizer is missing', async () => {
      const event = {
        requestContext: { authorizer: null },
        body: JSON.stringify({ fileName: 'test.pdf', contentType: 'application/pdf', fileSize: 1000 }),
      };

      const response = await handler(event);

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Input Validation', () => {
    it('should return 400 when fileName is missing', async () => {
      const event = createEvent({ contentType: 'application/pdf', fileSize: 1000 });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toContain('Missing required fields');
    });

    it('should return 400 when contentType is missing', async () => {
      const event = createEvent({ fileName: 'test.pdf', fileSize: 1000 });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toContain('Missing required fields');
    });

    it('should return 400 when fileSize is missing', async () => {
      const event = createEvent({ fileName: 'test.pdf', contentType: 'application/pdf' });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toContain('Missing required fields');
    });
  });

  describe('File Size Validation', () => {
    it('should return 400 when file size exceeds maximum (10MB)', async () => {
      const event = createEvent({
        fileName: 'large-file.pdf',
        contentType: 'application/pdf',
        fileSize: 11 * 1024 * 1024, // 11 MB
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toContain('exceeds maximum');
    });

    it('should accept file at exactly maximum size', async () => {
      const event = createEvent({
        fileName: 'max-file.pdf',
        contentType: 'application/pdf',
        fileSize: 10 * 1024 * 1024, // 10 MB exactly
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
    });
  });

  describe('MIME Type Validation', () => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/json',
    ];

    it.each(allowedTypes)('should accept allowed MIME type: %s', async (contentType) => {
      const event = createEvent({
        fileName: 'test-file',
        contentType,
        fileSize: 1000,
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
    });

    it('should reject disallowed MIME type', async () => {
      const event = createEvent({
        fileName: 'malicious.exe',
        contentType: 'application/x-msdownload',
        fileSize: 1000,
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toContain('not allowed');
      expect(body.allowedTypes).toBeDefined();
    });

    it('should reject video files', async () => {
      const event = createEvent({
        fileName: 'video.mp4',
        contentType: 'video/mp4',
        fileSize: 1000,
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Successful Upload', () => {
    it('should return presigned URL and file metadata', async () => {
      const event = createEvent({
        fileName: 'document.pdf',
        contentType: 'application/pdf',
        fileSize: 5000,
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.presignedUrl).toBe('https://s3.presigned.url/test');
      expect(body.fileId).toBeDefined();
      expect(body.s3Key).toContain(`users/${mockUserId}/uploads/`);
      expect(body.expiresIn).toBe(3600);
    });

    it('should generate S3 key with user prefix for security', async () => {
      const event = createEvent({
        fileName: 'test.pdf',
        contentType: 'application/pdf',
        fileSize: 1000,
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(body.s3Key).toMatch(new RegExp(`^users/${mockUserId}/uploads/`));
    });

    it('should sanitize file names', async () => {
      const event = createEvent({
        fileName: '../../../etc/passwd',
        contentType: 'text/plain',
        fileSize: 100,
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.s3Key).not.toContain('..');
      expect(body.s3Key).toContain('_');
    });
  });

  describe('Response Format', () => {
    it('should include CORS headers', async () => {
      const event = createEvent({
        fileName: 'test.pdf',
        contentType: 'application/pdf',
        fileSize: 1000,
      });

      const response = await handler(event);

      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers['Content-Type']).toBe('application/json');
    });

    it('should return valid JSON body', async () => {
      const event = createEvent({
        fileName: 'test.pdf',
        contentType: 'application/pdf',
        fileSize: 1000,
      });

      const response = await handler(event);

      expect(() => JSON.parse(response.body)).not.toThrow();
    });
  });
});
