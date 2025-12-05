import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const BUCKET_NAME = "660348065850-file-bucket";
const USER_FILES_TABLE = "UserFiles";
const FILE_AUDIT_TABLE = "FileAudit";

/**
 * POST /files/presigned/download
 * Generates a presigned URL for downloading a user's file from S3.
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

    const body = JSON.parse(event.body || "{}");
    const { fileId } = body;

    if (!fileId) {
      return buildResponse(400, { error: "Missing required field: fileId" });
    }

    // Get file metadata from DynamoDB
    const fileResult = await docClient.send(
      new GetCommand({
        TableName: USER_FILES_TABLE,
        Key: {
          userId,
          fileId,
        },
      })
    );

    if (!fileResult.Item) {
      return buildResponse(404, { error: "File not found" });
    }

    const file = fileResult.Item;

    // Check if file is deleted
    if (file.status === "deleted") {
      return buildResponse(404, { error: "File has been deleted" });
    }

    // Create presigned URL for download
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: file.s3Key,
      ResponseContentDisposition: `attachment; filename="${file.fileName}"`,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1 hour
    });

    // Log audit event
    await logAuditEvent(userId, fileId, "download", {
      fileName: file.fileName,
      s3Key: file.s3Key,
    });

    return buildResponse(200, {
      presignedUrl,
      fileName: file.fileName,
      contentType: file.contentType,
      fileSize: file.fileSize,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error("Error generating presigned download URL:", error);
    return buildResponse(500, { error: "Internal server error" });
  }
};

/**
 * Log audit event to FileAudit table
 */
async function logAuditEvent(userId, fileId, action, metadata = {}) {
  try {
    await docClient.send(
      new PutCommand({
        TableName: FILE_AUDIT_TABLE,
        Item: {
          userId,
          timestamp: new Date().toISOString(),
          fileId,
          action,
          metadata,
        },
      })
    );
  } catch (error) {
    console.error("Error logging audit event:", error);
    // Don't fail the main operation if audit logging fails
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
