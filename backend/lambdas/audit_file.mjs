import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const FILE_AUDIT_TABLE = "FileAudit";

/**
 * POST /files/audit
 * Registers access or download attempts in DynamoDB.
 * Can also be used to query audit logs for a user.
 */
export const handler = async (event) => {
  try {
    const claims =
      event.requestContext?.authorizer?.claims ||
      event.requestContext?.authorizer?.jwt?.claims ||
      event.requestContext?.authorizer;
    let userId = claims?.sub;

    // Fallback: extract sub from JWT in Authorization header when no authorizer context is provided
    if (!userId) {
      const authHeader = event.headers?.Authorization || event.headers?.authorization;
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

    const httpMethod = event.httpMethod || event.requestContext?.http?.method;

    // For both GET and POST, use getAuditLogs to list logs.
    // POST can send filters in the body; GET uses query string parameters.
    if (httpMethod === "GET") {
      return await getAuditLogs(userId, event.queryStringParameters || {});
    }

    if (httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const mergedParams = {
        ...(event.queryStringParameters || {}),
        ...(body || {}),
      };

      return await getAuditLogs(userId, mergedParams);
    }

    return buildResponse(405, { error: "Method not allowed" });
  } catch (error) {
    console.error("Error processing audit request:", error);
    return buildResponse(500, { error: "Internal server error" });
  }
};

/**
 * Query audit logs for a user
 */
async function getAuditLogs(userId, queryParams) {
  try {
    const limit = Math.min(parseInt(queryParams.limit) || 50, 100);
    const startDate = queryParams.startDate || null;
    const endDate = queryParams.endDate || null;

    const fileIdFilter = queryParams.fileId || null;
    const actionFilter = queryParams.action || null;

    let keyConditionExpression = "userId = :userId";
    const expressionAttributeValues = {
      ":userId": userId,
    };

    const expressionAttributeNames = {};

    const filterExpressions = [];

    // Optional filters by fileId and action
    if (fileIdFilter) {
      filterExpressions.push("#fileId = :fileId");
      expressionAttributeNames["#fileId"] = "fileId";
      expressionAttributeValues[":fileId"] = fileIdFilter;
    }

    if (actionFilter) {
      filterExpressions.push("#action = :action");
      expressionAttributeNames["#action"] = "action";
      expressionAttributeValues[":action"] = actionFilter;
    }

    // Add date range filter if provided
    if (startDate && endDate) {
      expressionAttributeNames["#timestamp"] = "timestamp";
      keyConditionExpression += " AND #timestamp BETWEEN :startDate AND :endDate";
      expressionAttributeValues[":startDate"] = startDate;
      expressionAttributeValues[":endDate"] = endDate;
    } else if (startDate) {
      expressionAttributeNames["#timestamp"] = "timestamp";
      keyConditionExpression += " AND #timestamp >= :startDate";
      expressionAttributeValues[":startDate"] = startDate;
    } else if (endDate) {
      expressionAttributeNames["#timestamp"] = "timestamp";
      keyConditionExpression += " AND #timestamp <= :endDate";
      expressionAttributeValues[":endDate"] = endDate;
    }

    const exclusiveStartKey = queryParams.nextToken
      ? JSON.parse(Buffer.from(queryParams.nextToken, "base64").toString("utf-8"))
      : undefined;

    const queryInput = {
      TableName: FILE_AUDIT_TABLE,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
      ScanIndexForward: false, // Most recent first
    };

    if (Object.keys(expressionAttributeNames).length > 0) {
      queryInput.ExpressionAttributeNames = expressionAttributeNames;
    }

    if (filterExpressions.length > 0) {
      queryInput.FilterExpression = filterExpressions.join(" AND ");
    }

    const queryCommand = new QueryCommand(queryInput);

    const result = await docClient.send(queryCommand);

    let nextToken = null;
    if (result.LastEvaluatedKey) {
      nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64");
    }

    return buildResponse(200, {
      auditLogs: result.Items || [],
      count: (result.Items || []).length,
      nextToken,
    });
  } catch (error) {
    console.error("Error querying audit logs:", error);
    throw error;
  }
}

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
