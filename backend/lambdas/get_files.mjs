import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const USER_FILES_TABLE = "UserFiles";
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * GET /files
 * Lists user files with pagination from DynamoDB.
 */
export const handler = async (event) => {
  try {
    const authorizerContext = event.requestContext?.authorizer;
    console.log("Authorizer context:", JSON.stringify(authorizerContext, null, 2));

    const claims =
      authorizerContext?.claims ||
      authorizerContext?.jwt?.claims ||
      authorizerContext;

    let userId =
      claims?.sub ||
      claims?.["cognito:username"] ||
      authorizerContext?.principalId ||
      event.requestContext?.identity?.cognitoIdentityId;

    // Fallback: extract sub from JWT in Authorization header when no authorizer context is provided
    if (!userId) {
      const authHeader = event.headers?.Authorization || event.headers?.authorization;
      console.log("Auth header prefix:", authHeader ? authHeader.slice(0, 40) : "<none>");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice("Bearer ".length);
        const parts = token.split(".");
        if (parts.length === 3) {
          try {
            const payloadJson = Buffer.from(parts[1], "base64").toString("utf-8");
            const payload = JSON.parse(payloadJson);
            userId = payload.sub || payload["cognito:username"];
          } catch (e) {
            console.error("Failed to decode JWT payload", e);
          }
        }
      }
    }
    if (!userId) {
      return buildResponse(401, { error: "Unauthorized: userId not found" });
    }

    const queryParams = event.queryStringParameters || {};
    
    // Parse pagination parameters
    let limit = parseInt(queryParams.limit) || DEFAULT_PAGE_SIZE;
    limit = Math.min(limit, MAX_PAGE_SIZE);
    
    const exclusiveStartKey = queryParams.nextToken
      ? JSON.parse(Buffer.from(queryParams.nextToken, "base64").toString("utf-8"))
      : undefined;

    // Query files for the user
    const queryCommand = new QueryCommand({
      TableName: USER_FILES_TABLE,
      KeyConditionExpression: "userId = :userId",
      FilterExpression: "#status <> :deleted",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":userId": userId,
        ":deleted": "deleted",
      },
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
      ScanIndexForward: false, // Most recent first
    });

    const result = await docClient.send(queryCommand);

    // Build next token for pagination
    let nextToken = null;
    if (result.LastEvaluatedKey) {
      nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64");
    }

    // Map items to response format
    const files = (result.Items || []).map((item) => ({
      fileId: item.fileId,
      fileName: item.fileName,
      contentType: item.contentType,
      fileSize: item.fileSize,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    return buildResponse(200, {
      files,
      count: files.length,
      nextToken,
    });
  } catch (error) {
    console.error("Error listing files:", error);
    return buildResponse(500, { error: "Internal server error" });
  }
};

/**
 * Build HTTP response
 */
function buildResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
    body: JSON.stringify(body),
  };
}
