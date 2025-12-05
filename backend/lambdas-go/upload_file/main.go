// Package main implements the upload_file Lambda function
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"

	"compinche-file-manager/lambdas-go/common"
)

const (
	bucketName     = "660348065850-file-bucket"
	userFilesTable = "UserFiles"
	fileAuditTable = "FileAudit"
	maxFileSize    = 10 * 1024 * 1024 // 10 MB
	presignExpiry  = 3600             // 1 hour
)

var allowedMimeTypes = map[string]bool{
	"image/jpeg":         true,
	"image/png":          true,
	"image/gif":          true,
	"image/webp":         true,
	"application/pdf":    true,
	"application/msword": true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
	"text/plain":       true,
	"application/json": true,
}

// UploadRequest represents the request body
type UploadRequest struct {
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	FileSize    int64  `json:"fileSize"`
}

// UploadResponse represents the response body
type UploadResponse struct {
	PresignedURL string `json:"presignedUrl"`
	FileID       string `json:"fileId"`
	S3Key        string `json:"s3Key"`
	ExpiresIn    int    `json:"expiresIn"`
}

// FileMetadata represents file metadata in DynamoDB
type FileMetadata struct {
	UserID      string `dynamodbav:"userId"`
	FileID      string `dynamodbav:"fileId"`
	FileName    string `dynamodbav:"fileName"`
	ContentType string `dynamodbav:"contentType"`
	FileSize    int64  `dynamodbav:"fileSize"`
	S3Key       string `dynamodbav:"s3Key"`
	Status      string `dynamodbav:"status"`
	CreatedAt   string `dynamodbav:"createdAt"`
}

// AuditEntry represents an audit log entry
type AuditEntry struct {
	UserID    string                 `dynamodbav:"userId"`
	Timestamp string                 `dynamodbav:"timestamp"`
	FileID    string                 `dynamodbav:"fileId"`
	Action    string                 `dynamodbav:"action"`
	Metadata  map[string]interface{} `dynamodbav:"metadata"`
}

var (
	s3Client        *s3.Client
	s3PresignClient *s3.PresignClient
	dynamoClient    *dynamodb.Client
)

func init() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}
	s3Client = s3.NewFromConfig(cfg)
	s3PresignClient = s3.NewPresignClient(s3Client)
	dynamoClient = dynamodb.NewFromConfig(cfg)
}

// Handler is the Lambda function handler
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Log authorizer context for debugging
	log.Printf("Authorizer context: %+v", request.RequestContext.Authorizer)

	// Extract user ID
	userID, err := common.ExtractUserID(request)
	if err != nil {
		log.Printf("Auth error: %v", err)
		return common.BuildErrorResponse(401, "Unauthorized: userId not found"), nil
	}

	// Parse request body
	var req UploadRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return common.BuildErrorResponse(400, "Invalid request body"), nil
	}

	// Validate required fields
	if req.FileName == "" || req.ContentType == "" || req.FileSize == 0 {
		return common.BuildErrorResponse(400, "Missing required fields: fileName, contentType, fileSize"), nil
	}

	// Validate file size
	if req.FileSize > maxFileSize {
		return common.BuildErrorResponse(400, fmt.Sprintf("File size exceeds maximum allowed (%d MB)", maxFileSize/1024/1024)), nil
	}

	// Validate MIME type
	if !allowedMimeTypes[req.ContentType] {
		return common.BuildErrorResponse(400, fmt.Sprintf("Content type '%s' is not allowed", req.ContentType)), nil
	}

	// Generate unique file ID and S3 key
	fileID := uuid.New().String()
	sanitizedName := sanitizeFileName(req.FileName)
	s3Key := fmt.Sprintf("users/%s/uploads/%s-%s", userID, fileID, sanitizedName)

	// Create presigned URL
	presignReq, err := s3PresignClient.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(bucketName),
		Key:           aws.String(s3Key),
		ContentType:   aws.String(req.ContentType),
		ContentLength: aws.Int64(req.FileSize),
	}, s3.WithPresignExpires(time.Duration(presignExpiry)*time.Second))
	if err != nil {
		log.Printf("Presign error: %v", err)
		return common.BuildErrorResponse(500, "Internal server error"), nil
	}

	// Save file metadata to DynamoDB
	metadata := FileMetadata{
		UserID:      userID,
		FileID:      fileID,
		FileName:    req.FileName,
		ContentType: req.ContentType,
		FileSize:    req.FileSize,
		S3Key:       s3Key,
		Status:      "pending",
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	}

	item, err := attributevalue.MarshalMap(metadata)
	if err != nil {
		log.Printf("Marshal error: %v", err)
		return common.BuildErrorResponse(500, "Internal server error"), nil
	}

	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(userFilesTable),
		Item:      item,
	})
	if err != nil {
		log.Printf("DynamoDB put error: %v", err)
		return common.BuildErrorResponse(500, "Internal server error"), nil
	}

	// Log audit event
	go logAuditEvent(ctx, userID, fileID, "upload", map[string]interface{}{
		"fileName":    req.FileName,
		"contentType": req.ContentType,
		"fileSize":    req.FileSize,
		"s3Key":       s3Key,
	})

	response := UploadResponse{
		PresignedURL: presignReq.URL,
		FileID:       fileID,
		S3Key:        s3Key,
		ExpiresIn:    presignExpiry,
	}

	return common.BuildResponse(200, response), nil
}

// sanitizeFileName removes dangerous characters from file names
func sanitizeFileName(fileName string) string {
	// Replace non-alphanumeric characters (except . - _) with underscore
	re := regexp.MustCompile(`[^a-zA-Z0-9._-]`)
	sanitized := re.ReplaceAllString(fileName, "_")

	// Remove consecutive dots
	re = regexp.MustCompile(`\.{2,}`)
	sanitized = re.ReplaceAllString(sanitized, ".")

	// Limit length
	if len(sanitized) > 255 {
		sanitized = sanitized[:255]
	}

	return sanitized
}

// logAuditEvent logs an audit event to DynamoDB
func logAuditEvent(ctx context.Context, userID, fileID, action string, metadata map[string]interface{}) {
	entry := AuditEntry{
		UserID:    userID,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		FileID:    fileID,
		Action:    action,
		Metadata:  metadata,
	}

	item, err := attributevalue.MarshalMap(entry)
	if err != nil {
		log.Printf("Audit marshal error: %v", err)
		return
	}

	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(fileAuditTable),
		Item:      item,
	})
	if err != nil {
		log.Printf("Audit log error: %v", err)
	}
}

func main() {
	lambda.Start(Handler)
}
