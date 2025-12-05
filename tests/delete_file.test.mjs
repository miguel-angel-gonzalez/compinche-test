/**
 * Unit tests for delete_file Lambda
 */

import { jest } from '@jest/globals';

// Mock AWS SDK clients
const mockS3Send = jest.fn();
const mockDynamoSend = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  DeleteObjectCommand: jest.fn((params) => params),
}));

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.unstable_mockModule('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockDynamoSend })),
  },
  GetCommand: jest.fn((params) => ({ ...params, type: 'GetCommand' })),
  UpdateCommand: jest.fn((params) => ({ ...params, type: 'UpdateCommand' })),
  PutCommand: jest.fn((params) => ({ ...params, type: 'PutCommand' })),
}));

// Import handler after mocking
const { handler } = await import('../backend/lambdas/delete_file.mjs');

describe('Delete File Lambda', () => {
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
    mockS3Send.mockResolvedValue({});
    mockDynamoSend.mockResolvedValue({ Item: mockFileRecord });
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
      mockDynamoSend.mockResolvedValueOnce({ Item: null });

      const event = createEvent({ fileId: 'non-existent-file' });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(404);
      expect(body.error).toContain('not found');
    });

    it('should return 400 when file is already deleted', async () => {
      mockDynamoSend.mockResolvedValueOnce({
        Item: { ...mockFileRecord, status: 'deleted' },
      });

      const event = createEvent({ fileId: mockFileId });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toContain('already deleted');
    });
  });

  describe('Successful Deletion', () => {
    it('should delete file from S3', async () => {
      const event = createEvent({ fileId: mockFileId });

      await handler(event);

      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: '660348065850-file-bucket',
          Key: mockFileRecord.s3Key,
        })
      );
    });

    it('should mark file as deleted in DynamoDB (soft delete)', async () => {
      const event = createEvent({ fileId: mockFileId });

      await handler(event);

      // Find the UpdateCommand call
      const updateCall = mockDynamoSend.mock.calls.find(
        (call) => call[0].type === 'UpdateCommand'
      );

      expect(updateCall).toBeDefined();
      expect(updateCall[0].UpdateExpression).toContain('deleted');
    });

    it('should return success message with file info', async () => {
      const event = createEvent({ fileId: mockFileId });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.message).toContain('deleted successfully');
      expect(body.fileId).toBe(mockFileId);
      expect(body.fileName).toBe('document.pdf');
    });

    it('should log audit event on successful deletion', async () => {
      const event = createEvent({ fileId: mockFileId });

      await handler(event);

      // Find the PutCommand call (audit log)
      const auditCall = mockDynamoSend.mock.calls.find(
        (call) => call[0].type === 'PutCommand'
      );

      expect(auditCall).toBeDefined();
      expect(auditCall[0].Item.action).toBe('delete');
    });

    it('should continue with DynamoDB update even if S3 delete fails', async () => {
      mockS3Send.mockRejectedValueOnce(new Error('S3 Error'));

      const event = createEvent({ fileId: mockFileId });

      const response = await handler(event);

      // Should still succeed (soft delete in DynamoDB)
      expect(response.statusCode).toBe(200);
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
