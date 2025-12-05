// Package main implements the delete_file Lambda function
package main

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"compinche-file-manager/lambdas-go/common"
)

const (
	bucketName     = "660348065850-file-bucket"
	userFilesTable = "UserFiles"
	fileAuditTable = "FileAudit"
)

// DeleteRequest represents the request body
type DeleteRequest struct {
	FileID     string `json:"fileId"`
	HardDelete bool   `json:"hardDelete"`
}

// DeleteResponse represents the response body
type DeleteResponse struct {
	Message  string `json:"message"`
	FileID   string `json:"fileId"`
	FileName string `json:"fileName"`
}

// FileRecord represents a file record from DynamoDB
type FileRecord struct {
	UserID      string `dynamodbav:"userId"`
	FileID      string `dynamodbav:"fileId"`
	FileName    string `dynamodbav:"fileName"`
	ContentType string `dynamodbav:"contentType"`
	FileSize    int64  `dynamodbav:"fileSize"`
	S3Key       string `dynamodbav:"s3Key"`
	Status      string `dynamodbav:"status"`
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
	s3Client     *s3.Client
	dynamoClient *dynamodb.Client
)

func init() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}
	s3Client = s3.NewFromConfig(cfg)
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
	var req DeleteRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return common.BuildErrorResponse(400, "Invalid request body"), nil
	}

	// Validate required fields
	if req.FileID == "" {
		return common.BuildErrorResponse(400, "Missing required field: fileId"), nil
	}

	// Get file metadata from DynamoDB
	result, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(userFilesTable),
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
			"fileId": &types.AttributeValueMemberS{Value: req.FileID},
		},
	})
	if err != nil {
		log.Printf("DynamoDB get error: %v", err)
		return common.BuildErrorResponse(500, "Internal server error"), nil
	}

	if result.Item == nil {
		return common.BuildErrorResponse(404, "File not found"), nil
	}

	var file FileRecord
	if err := attributevalue.UnmarshalMap(result.Item, &file); err != nil {
		log.Printf("Unmarshal error: %v", err)
		return common.BuildErrorResponse(500, "Internal server error"), nil
	}

	// Check if file is already deleted
	if file.Status == "deleted" {
		return common.BuildErrorResponse(400, "File is already deleted"), nil
	}

	// Delete file from S3
	_, err = s3Client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(bucketName),
		Key:    aws.String(file.S3Key),
	})
	if err != nil {
		log.Printf("S3 delete error: %v", err)
		// Continue with DynamoDB update even if S3 delete fails
	}

	// Soft delete: mark as deleted in DynamoDB
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = dynamoClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(userFilesTable),
		Key: map[string]types.AttributeValue{
			"userId": &types.AttributeValueMemberS{Value: userID},
			"fileId": &types.AttributeValueMemberS{Value: req.FileID},
		},
		UpdateExpression: aws.String("SET #status = :deleted, deletedAt = :deletedAt, updatedAt = :updatedAt"),
		ExpressionAttributeNames: map[string]string{
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":deleted":   &types.AttributeValueMemberS{Value: "deleted"},
			":deletedAt": &types.AttributeValueMemberS{Value: now},
			":updatedAt": &types.AttributeValueMemberS{Value: now},
		},
	})
	if err != nil {
		log.Printf("DynamoDB update error: %v", err)
		return common.BuildErrorResponse(500, "Internal server error"), nil
	}

	// Log audit event
	go logAuditEvent(ctx, userID, req.FileID, "delete", map[string]interface{}{
		"fileName":   file.FileName,
		"s3Key":      file.S3Key,
		"hardDelete": req.HardDelete,
	})

	response := DeleteResponse{
		Message:  "File deleted successfully",
		FileID:   req.FileID,
		FileName: file.FileName,
	}

	return common.BuildResponse(200, response), nil
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
