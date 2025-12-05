import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const BUCKET_NAME = "660348065850-file-bucket";
const USER_FILES_TABLE = "UserFiles";
const FILE_AUDIT_TABLE = "FileAudit";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "application/json",
];

/**
 * POST /files/presigned/upload
 * Generates a presigned URL for uploading a file to S3.
 * Validates: max file size, allowed MIME types, secure prefix based on userId.
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
    const { fileName, contentType, fileSize } = body;

    // Validate required fields
    if (!fileName || !contentType || !fileSize) {
      return buildResponse(400, {
        error: "Missing required fields: fileName, contentType, fileSize",
      });
    }

    // Validate file size
    if (fileSize > MAX_FILE_SIZE) {
      return buildResponse(400, {
        error: `File size exceeds maximum allowed (${MAX_FILE_SIZE / 1024 / 1024} MB)`,
      });
    }

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
      return buildResponse(400, {
        error: `Content type '${contentType}' is not allowed`,
        allowedTypes: ALLOWED_MIME_TYPES,
      });
    }

    // Generate unique file ID and secure S3 key
    const fileId = randomUUID();
    const s3Key = `users/${userId}/uploads/${fileId}-${sanitizeFileName(fileName)}`;

    // Create presigned URL for upload
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: contentType,
      ContentLength: fileSize,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1 hour
    });

    // Save file metadata to DynamoDB
    await docClient.send(
      new PutCommand({
        TableName: USER_FILES_TABLE,
        Item: {
          userId,
          fileId,
          fileName,
          contentType,
          fileSize,
          s3Key,
          status: "pending",
          createdAt: new Date().toISOString(),
        },
      })
    );

    // Log audit event for upload
    await logAuditEvent(userId, fileId, "upload", {
      fileName,
      contentType,
      fileSize,
      s3Key,
    });

    return buildResponse(200, {
      presignedUrl,
      fileId,
      s3Key,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error("Error generating presigned upload URL:", error);
    return buildResponse(500, { error: "Internal server error" });
  }
};

/**
 * Sanitize file name to prevent path traversal and special characters
 */
function sanitizeFileName(fileName) {
  return fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .substring(0, 255);
}

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
    // Do not fail the main operation if audit logging fails
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
