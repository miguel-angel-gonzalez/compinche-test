// Package main implements the get_files Lambda function
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"log"
	"strconv"

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
	userFilesTable  = "UserFiles"
	defaultPageSize = 20
	maxPageSize     = 100
)

// FileItem represents a file record from DynamoDB
type FileItem struct {
	UserID      string `dynamodbav:"userId" json:"userId,omitempty"`
	FileID      string `dynamodbav:"fileId" json:"fileId"`
	FileName    string `dynamodbav:"fileName" json:"fileName"`
	ContentType string `dynamodbav:"contentType" json:"contentType"`
	FileSize    int64  `dynamodbav:"fileSize" json:"fileSize"`
	Status      string `dynamodbav:"status" json:"status"`
	CreatedAt   string `dynamodbav:"createdAt" json:"createdAt"`
	UpdatedAt   string `dynamodbav:"updatedAt" json:"updatedAt,omitempty"`
}

// ListFilesResponse represents the response body
type ListFilesResponse struct {
	Files     []FileItem `json:"files"`
	Count     int        `json:"count"`
	NextToken *string    `json:"nextToken"`
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

	// Parse pagination parameters
	limit := defaultPageSize
	if limitStr := request.QueryStringParameters["limit"]; limitStr != "" {
		if parsedLimit, err := strconv.Atoi(limitStr); err == nil {
			limit = parsedLimit
		}
	}
	if limit > maxPageSize {
		limit = maxPageSize
	}

	// Parse next token for pagination
	var exclusiveStartKey map[string]types.AttributeValue
	if nextToken := request.QueryStringParameters["nextToken"]; nextToken != "" {
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
		TableName:              aws.String(userFilesTable),
		KeyConditionExpression: aws.String("userId = :userId"),
		FilterExpression:       aws.String("#status <> :deleted"),
		ExpressionAttributeNames: map[string]string{
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":userId":  &types.AttributeValueMemberS{Value: userID},
			":deleted": &types.AttributeValueMemberS{Value: "deleted"},
		},
		Limit:             aws.Int32(int32(limit)),
		ExclusiveStartKey: exclusiveStartKey,
		ScanIndexForward:  aws.Bool(false), // Most recent first
	}

	result, err := dynamoClient.Query(ctx, input)
	if err != nil {
		log.Printf("DynamoDB query error: %v", err)
		return common.BuildErrorResponse(500, "Internal server error"), nil
	}

	// Unmarshal items
	var files []FileItem
	if err := attributevalue.UnmarshalListOfMaps(result.Items, &files); err != nil {
		log.Printf("Unmarshal error: %v", err)
		return common.BuildErrorResponse(500, "Internal server error"), nil
	}

	// Remove userId from response items
	for i := range files {
		files[i].UserID = ""
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

	response := ListFilesResponse{
		Files:     files,
		Count:     len(files),
		NextToken: nextToken,
	}

	return common.BuildResponse(200, response), nil
}

func main() {
	lambda.Start(Handler)
}
