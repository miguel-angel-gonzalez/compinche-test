/**
 * Unit tests for get_files Lambda
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
  QueryCommand: jest.fn((params) => ({ ...params, type: 'QueryCommand' })),
}));

// Import handler after mocking
const { handler } = await import('../backend/lambdas/get_files.mjs');

describe('Get Files Lambda', () => {
  const mockUserId = 'test-user-123';

  const mockFiles = [
    {
      userId: mockUserId,
      fileId: 'file-1',
      fileName: 'document.pdf',
      contentType: 'application/pdf',
      fileSize: 5000,
      status: 'uploaded',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      userId: mockUserId,
      fileId: 'file-2',
      fileName: 'image.png',
      contentType: 'image/png',
      fileSize: 2000,
      status: 'uploaded',
      createdAt: '2024-01-02T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    },
  ];

  const createEvent = (queryParams = null, userId = mockUserId) => ({
    requestContext: {
      authorizer: {
        claims: { sub: userId },
      },
    },
    queryStringParameters: queryParams,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Items: mockFiles });
  });

  describe('Authentication', () => {
    it('should return 401 when userId is not present', async () => {
      const event = {
        requestContext: {},
        queryStringParameters: null,
      };

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(401);
      expect(body.error).toContain('Unauthorized');
    });

    it('should return 401 when authorizer is missing', async () => {
      const event = {
        requestContext: { authorizer: null },
        queryStringParameters: null,
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
        },
        queryStringParameters: null,
      };

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
    });

    it('should extract userId from principalId fallback', async () => {
      const event = {
        requestContext: {
          authorizer: {
            principalId: mockUserId,
          },
        },
        queryStringParameters: null,
      };

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
    });
  });

  describe('File Listing', () => {
    it('should return list of files for user', async () => {
      const event = createEvent();

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.files).toHaveLength(2);
      expect(body.count).toBe(2);
    });

    it('should map file properties correctly', async () => {
      const event = createEvent();

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(body.files[0]).toEqual({
        fileId: 'file-1',
        fileName: 'document.pdf',
        contentType: 'application/pdf',
        fileSize: 5000,
        status: 'uploaded',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
    });

    it('should return empty array when no files exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent();

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.files).toEqual([]);
      expect(body.count).toBe(0);
    });
  });

  describe('Pagination', () => {
    it('should use default page size of 20', async () => {
      const event = createEvent();

      await handler(event);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Limit: 20,
        })
      );
    });

    it('should respect custom limit parameter', async () => {
      const event = createEvent({ limit: '50' });

      await handler(event);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Limit: 50,
        })
      );
    });

    it('should cap limit at 100', async () => {
      const event = createEvent({ limit: '200' });

      await handler(event);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Limit: 100,
        })
      );
    });

    it('should return nextToken when more results exist', async () => {
      const lastKey = { userId: mockUserId, fileId: 'file-2' };
      mockSend.mockResolvedValueOnce({
        Items: mockFiles,
        LastEvaluatedKey: lastKey,
      });

      const event = createEvent();

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(body.nextToken).toBeDefined();
    });

    it('should not return nextToken when no more results', async () => {
      mockSend.mockResolvedValueOnce({
        Items: mockFiles,
        LastEvaluatedKey: undefined,
      });

      const event = createEvent();

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(body.nextToken).toBeNull();
    });
  });

  describe('Response Format', () => {
    it('should include CORS headers', async () => {
      const event = createEvent();

      const response = await handler(event);

      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers['Content-Type']).toBe('application/json');
    });

    it('should return valid JSON body', async () => {
      const event = createEvent();

      const response = await handler(event);

      expect(() => JSON.parse(response.body)).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should return 500 on DynamoDB error', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB Error'));

      const event = createEvent();

      const response = await handler(event);

      expect(response.statusCode).toBe(500);
    });
  });
});
