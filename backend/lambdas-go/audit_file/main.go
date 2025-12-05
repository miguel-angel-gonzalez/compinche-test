// Package main implements the audit_file Lambda function
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"log"
	"strconv"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"compinche-file-manager/lambdas-go/common"
)

const (
	fileAuditTable = "FileAudit"
	defaultLimit   = 50
	maxLimit       = 100
)

var validActions = map[string]bool{
	"view":           true,
	"download":       true,
	"upload":         true,
	"delete":         true,
	"share":          true,
	"access_attempt": true,
}

// AuditRequest represents the POST request body
type AuditRequest struct {
	FileID   string                 `json:"fileId"`
	Action   string                 `json:"action"`
	Metadata map[string]interface{} `json:"metadata"`
}

// AuditEntry represents an audit log entry
type AuditEntry struct {
	UserID    string                 `dynamodbav:"userId" json:"userId"`
	Timestamp string                 `dynamodbav:"timestamp" json:"timestamp"`
	FileID    string                 `dynamodbav:"fileId" json:"fileId"`
	Action    string                 `dynamodbav:"action" json:"action"`
	Metadata  map[string]interface{} `dynamodbav:"metadata" json:"metadata,omitempty"`
}

// AuditCreateResponse represents the POST response
type AuditCreateResponse struct {
	Message    string            `json:"message"`
	AuditEntry AuditEntrySummary `json:"auditEntry"`
}

// AuditEntrySummary is a summary of the created audit entry
type AuditEntrySummary struct {
	UserID    string `json:"userId"`
	Timestamp string `json:"timestamp"`
	FileID    string `json:"fileId"`
	Action    string `json:"action"`
}

// AuditListResponse represents the GET response
type AuditListResponse struct {
	AuditLogs []AuditEntry `json:"auditLogs"`
	Count     int          `json:"count"`
	NextToken *string      `json:"nextToken"`
}

var dynamoClient *dynamodb.Client

func init() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}
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

	// Route based on HTTP method
	httpMethod := request.HTTPMethod
	if httpMethod == "" {
		httpMethod = request.RequestContext.HTTPMethod
	}

	switch httpMethod {
	case "GET":
		return handleGetAuditLogs(ctx, userID, request.QueryStringParameters)
	case "POST":
		return handleCreateAuditLog(ctx, userID, request)
	default:
		return common.BuildErrorResponse(405, "Method not allowed"), nil
	}
}

// handleGetAuditLogs handles GET requests to query audit logs
func handleGetAuditLogs(ctx context.Context, userID string, queryParams map[string]string) (events.APIGatewayProxyResponse, error) {
	// Parse limit
	limit := defaultLimit
	if limitStr := queryParams["limit"]; limitStr != "" {
		if parsedLimit, err := strconv.Atoi(limitStr); err == nil {
			limit = parsedLimit
		}
	}
	if limit > maxLimit {
		limit = maxLimit
	}

	// Build query
	keyConditionExpr := "userId = :userId"
	exprAttrValues := map[string]types.AttributeValue{
		":userId": &types.AttributeValueMemberS{Value: userID},
	}
	exprAttrNames := map[string]string{
		"#timestamp": "timestamp",
	}

	// Add date range filter if provided
	startDate := queryParams["startDate"]
	endDate := queryParams["endDate"]

	if startDate != "" && endDate != "" {
		keyConditionExpr += " AND #timestamp BETWEEN :startDate AND :endDate"
		exprAttrValues[":startDate"] = &types.AttributeValueMemberS{Value: startDate}
		exprAttrValues[":endDate"] = &types.AttributeValueMemberS{Value: endDate}
	} else if startDate != "" {
		keyConditionExpr += " AND #timestamp >= :startDate"
		exprAttrValues[":startDate"] = &types.AttributeValueMemberS{Value: startDate}
	} else if endDate != "" {
		keyConditionExpr += " AND #timestamp <= :endDate"
		exprAttrValues[":endDate"] = &types.AttributeValueMemberS{Value: endDate}
	}

	// Parse next token for pagination
	var exclusiveStartKey map[string]types.AttributeValue
	if nextToken := queryParams["nextToken"]; nextToken != "" {
		decoded, err := base64.StdEncoding.DecodeString(nextToken)
		if err == nil {
			var keyMap map[string]interface{}
			if json.Unmarshal(decoded, &keyMap) == nil {
				exclusiveStartKey, _ = attributevalue.MarshalMap(keyMap)
			}
		}
	}

	// Query DynamoDB
	input := &dynamodb.QueryInput{
		TableName:                 aws.String(fileAuditTable),
		KeyConditionExpression:    aws.String(keyConditionExpr),
		ExpressionAttributeNames:  exprAttrNames,
		ExpressionAttributeValues: exprAttrValues,
		Limit:                     aws.Int32(int32(limit)),
		ExclusiveStartKey:         exclusiveStartKey,
		ScanIndexForward:          aws.Bool(false), // Most recent first
	}

	result, err := dynamoClient.Query(ctx, input)
	if err != nil {
		log.Printf("DynamoDB query error: %v", err)
		return common.BuildErrorResponse(500, "Internal server error"), nil
	}

	// Unmarshal items
	var auditLogs []AuditEntry
	if err := attributevalue.UnmarshalListOfMaps(result.Items, &auditLogs); err != nil {
		log.Printf("Unmarshal error: %v", err)
		return common.BuildErrorResponse(500, "Internal server error"), nil
	}

	// Build next token
	var nextToken *string
	if result.LastEvaluatedKey != nil {
		var keyMap map[string]interface{}
		if attributevalue.UnmarshalMap(result.LastEvaluatedKey, &keyMap) == nil {
			if encoded, err := json.Marshal(keyMap); err == nil {
				token := base64.StdEncoding.EncodeToString(encoded)
				nextToken = &token
			}
		}
	}

	response := AuditListResponse{
		AuditLogs: auditLogs,
		Count:     len(auditLogs),
		NextToken: nextToken,
	}

	return common.BuildResponse(200, response), nil
}

// handleCreateAuditLog handles POST requests to create audit logs
func handleCreateAuditLog(ctx context.Context, userID string, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Parse request body
	var req AuditRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return common.BuildErrorResponse(400, "Invalid request body"), nil
	}

	// Validate required fields
	if req.FileID == "" || req.Action == "" {
		return common.BuildErrorResponse(400, "Missing required fields: fileId, action"), nil
	}

	// Validate action type
	if !validActions[req.Action] {
		return common.BuildErrorResponse(400, "Invalid action. Must be one of: view, download, upload, delete, share, access_attempt"), nil
	}

	// Build metadata with IP and user agent
	metadata := req.Metadata
	if metadata == nil {
		metadata = make(map[string]interface{})
	}

	ipAddress := request.RequestContext.Identity.SourceIP
	if ipAddress == "" {
		ipAddress = "unknown"
	}
	metadata["ipAddress"] = ipAddress

	userAgent := request.Headers["User-Agent"]
	if userAgent == "" {
		userAgent = request.Headers["user-agent"]
	}
	if userAgent == "" {
		userAgent = "unknown"
	}
	metadata["userAgent"] = userAgent

	// Create audit entry
	timestamp := time.Now().UTC().Format(time.RFC3339)
	entry := AuditEntry{
		UserID:    userID,
		Timestamp: timestamp,
		FileID:    req.FileID,
		Action:    req.Action,
		Metadata:  metadata,
	}

	item, err := attributevalue.MarshalMap(entry)
	if err != nil {
		log.Printf("Marshal error: %v", err)
		return common.BuildErrorResponse(500, "Internal server error"), nil
	}

	_, err = dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(fileAuditTable),
		Item:      item,
	})
	if err != nil {
		log.Printf("DynamoDB put error: %v", err)
		return common.BuildErrorResponse(500, "Internal server error"), nil
	}

	response := AuditCreateResponse{
		Message: "Audit log created successfully",
		AuditEntry: AuditEntrySummary{
			UserID:    userID,
			Timestamp: timestamp,
			FileID:    req.FileID,
			Action:    req.Action,
		},
	}

	return common.BuildResponse(201, response), nil
}

func main() {
	lambda.Start(Handler)
}
