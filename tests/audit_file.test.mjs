/**
 * Unit tests for audit_file Lambda
 */

import { jest } from '@jest/globals';

// Mock AWS SDK clients
const mockSend = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.unstable_mockModule('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  PutCommand: jest.fn((params) => ({ ...params, type: 'PutCommand' })),
  QueryCommand: jest.fn((params) => ({ ...params, type: 'QueryCommand' })),
}));

// Import handler after mocking
const { handler } = await import('../backend/lambdas/audit_file.mjs');

describe('Audit File Lambda', () => {
  const mockUserId = 'test-user-123';
  const mockFileId = 'file-uuid-456';

  const createEvent = (method, body = null, queryParams = null, userId = mockUserId) => ({
    requestContext: {
      authorizer: {
        claims: { sub: userId },
      },
      http: { method },
      identity: { sourceIp: '127.0.0.1' },
    },
    httpMethod: method,
    headers: {
      'User-Agent': 'test-agent',
    },
    body: body ? JSON.stringify(body) : null,
    queryStringParameters: queryParams,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  describe('Authentication', () => {
    it('should return 401 when userId is not present', async () => {
      const event = {
        requestContext: {},
        httpMethod: 'GET',
        body: null,
      };

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(401);
      expect(body.error).toContain('Unauthorized');
    });

    it('should return 401 when authorizer is missing', async () => {
      const event = {
        requestContext: { authorizer: null },
        httpMethod: 'GET',
        body: null,
      };

      const response = await handler(event);

      expect(response.statusCode).toBe(401);
    });

    it('should extract userId from cognito:username fallback', async () => {
      const event = {
        requestContext: {
          authorizer: {
            claims: { 'cognito:username': mockUserId },
          },
          http: { method: 'GET' },
        },
        httpMethod: 'GET',
        body: null,
        queryStringParameters: null,
      };

      mockSend.mockResolvedValueOnce({ Items: [] });

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
    });

    it('should extract userId from principalId fallback', async () => {
      const event = {
        requestContext: {
          authorizer: {
            principalId: mockUserId,
          },
          http: { method: 'GET' },
        },
        httpMethod: 'GET',
        body: null,
        queryStringParameters: null,
      };

      mockSend.mockResolvedValueOnce({ Items: [] });

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET - Query Audit Logs', () => {
    it('should return audit logs for user', async () => {
      const mockAuditLogs = [
        { userId: mockUserId, timestamp: '2024-01-01T00:00:00.000Z', fileId: mockFileId, action: 'download' },
        { userId: mockUserId, timestamp: '2024-01-01T01:00:00.000Z', fileId: mockFileId, action: 'view' },
      ];

      mockSend.mockResolvedValueOnce({ Items: mockAuditLogs });

      const event = createEvent('GET');

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.auditLogs).toEqual(mockAuditLogs);
      expect(body.count).toBe(2);
    });

    it('should handle pagination with nextToken', async () => {
      const lastKey = { userId: mockUserId, timestamp: '2024-01-01T00:00:00.000Z' };
      mockSend.mockResolvedValueOnce({
        Items: [{ userId: mockUserId, timestamp: '2024-01-02T00:00:00.000Z', fileId: mockFileId, action: 'upload' }],
        LastEvaluatedKey: lastKey,
      });

      const event = createEvent('GET');

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.nextToken).toBeDefined();
    });

    it('should filter by date range when provided', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent('GET', null, {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-31T23:59:59.999Z',
      });

      await handler(event);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeValues: expect.objectContaining({
            ':startDate': '2024-01-01T00:00:00.000Z',
            ':endDate': '2024-01-31T23:59:59.999Z',
          }),
        })
      );
    });

    it('should respect limit parameter', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent('GET', null, { limit: '25' });

      await handler(event);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Limit: 25,
        })
      );
    });

    it('should cap limit at 100', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent('GET', null, { limit: '200' });

      await handler(event);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Limit: 100,
        })
      );
    });
  });

  describe('POST - Create Audit Log', () => {
    it('should return 400 when fileId is missing', async () => {
      const event = createEvent('POST', { action: 'download' });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toContain('fileId');
    });

    it('should return 400 when action is missing', async () => {
      const event = createEvent('POST', { fileId: mockFileId });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toContain('action');
    });

    it('should return 400 for invalid action type', async () => {
      const event = createEvent('POST', { fileId: mockFileId, action: 'invalid_action' });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toContain('Invalid action');
    });

    const validActions = ['view', 'download', 'upload', 'delete', 'share', 'access_attempt'];

    it.each(validActions)('should accept valid action: %s', async (action) => {
      const event = createEvent('POST', { fileId: mockFileId, action });

      const response = await handler(event);

      expect(response.statusCode).toBe(201);
    });

    it('should create audit log entry successfully', async () => {
      const event = createEvent('POST', {
        fileId: mockFileId,
        action: 'download',
        metadata: { source: 'web' },
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(201);
      expect(body.message).toContain('successfully');
      expect(body.auditEntry.fileId).toBe(mockFileId);
      expect(body.auditEntry.action).toBe('download');
    });

    it('should include IP address and user agent in metadata', async () => {
      const event = createEvent('POST', { fileId: mockFileId, action: 'view' });

      await handler(event);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({
            metadata: expect.objectContaining({
              ipAddress: '127.0.0.1',
              userAgent: 'test-agent',
            }),
          }),
        })
      );
    });
  });

  describe('Response Format', () => {
    it('should include CORS headers', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent('GET');

      const response = await handler(event);

      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers['Content-Type']).toBe('application/json');
    });

    it('should return valid JSON body', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent('GET');

      const response = await handler(event);

      expect(() => JSON.parse(response.body)).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should return 500 on DynamoDB error', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB Error'));

      const event = createEvent('GET');

      const response = await handler(event);

      expect(response.statusCode).toBe(500);
    });
  });
});
