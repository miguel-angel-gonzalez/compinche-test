/**
 * Unit tests for download_file Lambda
 */

import { jest } from '@jest/globals';

// Mock AWS SDK clients
const mockGetSignedUrl = jest.fn();
const mockSend = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({})),
  GetObjectCommand: jest.fn((params) => params),
}));

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.unstable_mockModule('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  GetCommand: jest.fn((params) => ({ ...params, type: 'GetCommand' })),
  PutCommand: jest.fn((params) => ({ ...params, type: 'PutCommand' })),
}));

jest.unstable_mockModule('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

// Import handler after mocking
const { handler } = await import('../backend/lambdas/download_file.mjs');

describe('Download File Lambda', () => {
  const mockUserId = 'test-user-123';
  const mockFileId = 'file-uuid-456';
  
  const mockFileRecord = {
    userId: mockUserId,
    fileId: mockFileId,
    fileName: 'document.pdf',
    contentType: 'application/pdf',
    fileSize: 5000,
    s3Key: `users/${mockUserId}/uploads/${mockFileId}-document.pdf`,
    status: 'uploaded',
    createdAt: '2024-01-01T00:00:00.000Z',
  };

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
    mockGetSignedUrl.mockResolvedValue('https://s3.presigned.url/download');
    mockSend.mockResolvedValue({ Item: mockFileRecord });
  });

  describe('Authentication', () => {
    it('should return 401 when userId is not present', async () => {
      const event = {
        requestContext: {},
        body: JSON.stringify({ fileId: mockFileId }),
      };

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(401);
      expect(body.error).toContain('Unauthorized');
    });
  });

  describe('Input Validation', () => {
    it('should return 400 when fileId is missing', async () => {
      const event = createEvent({});

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toContain('fileId');
    });
  });

  describe('File Access', () => {
    it('should return 404 when file does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: null });

      const event = createEvent({ fileId: 'non-existent-file' });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(404);
      expect(body.error).toContain('not found');
    });

    it('should return 404 when file is deleted', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { ...mockFileRecord, status: 'deleted' },
      });

      const event = createEvent({ fileId: mockFileId });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(404);
      expect(body.error).toContain('deleted');
    });

    it('should only allow access to own files (userId in key)', async () => {
      const event = createEvent({ fileId: mockFileId });

      await handler(event);

      // Verify DynamoDB was queried with correct userId
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: expect.objectContaining({
            userId: mockUserId,
            fileId: mockFileId,
          }),
        })
      );
    });
  });

  describe('Successful Download', () => {
    it('should return presigned URL and file metadata', async () => {
      const event = createEvent({ fileId: mockFileId });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.presignedUrl).toBe('https://s3.presigned.url/download');
      expect(body.fileName).toBe('document.pdf');
      expect(body.contentType).toBe('application/pdf');
      expect(body.fileSize).toBe(5000);
      expect(body.expiresIn).toBe(3600);
    });

    it('should log audit event on successful download', async () => {
      const event = createEvent({ fileId: mockFileId });

      await handler(event);

      // Should have called send twice: once for GetCommand, once for PutCommand (audit)
      expect(mockSend).toHaveBeenCalledTimes(2);
      
      // Second call should be audit log
      const auditCall = mockSend.mock.calls[1][0];
      expect(auditCall.type).toBe('PutCommand');
      expect(auditCall.Item.action).toBe('download');
    });
  });

  describe('Response Format', () => {
    it('should include CORS headers', async () => {
      const event = createEvent({ fileId: mockFileId });

      const response = await handler(event);

      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers['Content-Type']).toBe('application/json');
    });
  });
});
