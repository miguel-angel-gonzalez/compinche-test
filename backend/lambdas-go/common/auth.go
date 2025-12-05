// Package common provides shared utilities for Lambda functions
package common

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/aws/aws-lambda-go/events"
)

// JWTPayload represents the decoded JWT payload
type JWTPayload struct {
	Sub             string `json:"sub"`
	CognitoUsername string `json:"cognito:username"`
}

// ExtractUserID extracts the user ID from the API Gateway event
// It tries multiple sources in order of priority:
// 1. Authorizer claims (sub or cognito:username)
// 2. Authorizer principalId
// 3. Identity cognitoIdentityId
// 4. JWT from Authorization header (fallback)
func ExtractUserID(request events.APIGatewayProxyRequest) (string, error) {
	// Try authorizer context first
	if request.RequestContext.Authorizer != nil {
		// Try claims.sub
		if claims, ok := request.RequestContext.Authorizer["claims"].(map[string]interface{}); ok {
			if sub, ok := claims["sub"].(string); ok && sub != "" {
				return sub, nil
			}
			if username, ok := claims["cognito:username"].(string); ok && username != "" {
				return username, nil
			}
		}

		// Try direct sub in authorizer
		if sub, ok := request.RequestContext.Authorizer["sub"].(string); ok && sub != "" {
			return sub, nil
		}

		// Try principalId
		if principalID, ok := request.RequestContext.Authorizer["principalId"].(string); ok && principalID != "" {
			return principalID, nil
		}
	}

	// Try identity cognitoIdentityId
	if request.RequestContext.Identity.CognitoIdentityID != "" {
		return request.RequestContext.Identity.CognitoIdentityID, nil
	}

	// Fallback: extract from Authorization header
	authHeader := request.Headers["Authorization"]
	if authHeader == "" {
		authHeader = request.Headers["authorization"]
	}

	if strings.HasPrefix(authHeader, "Bearer ") {
		token := strings.TrimPrefix(authHeader, "Bearer ")
		userID, err := extractUserIDFromJWT(token)
		if err == nil && userID != "" {
			return userID, nil
		}
	}

	return "", fmt.Errorf("unauthorized: userId not found")
}

// extractUserIDFromJWT decodes the JWT payload and extracts the user ID
func extractUserIDFromJWT(token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("invalid JWT format")
	}

	// Decode payload (second part)
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		// Try standard base64
		payloadBytes, err = base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			return "", fmt.Errorf("failed to decode JWT payload: %w", err)
		}
	}

	var payload JWTPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return "", fmt.Errorf("failed to parse JWT payload: %w", err)
	}

	if payload.Sub != "" {
		return payload.Sub, nil
	}
	if payload.CognitoUsername != "" {
		return payload.CognitoUsername, nil
	}

	return "", fmt.Errorf("no user ID found in JWT")
}

// BuildResponse creates a standardized API Gateway response
func BuildResponse(statusCode int, body interface{}) events.APIGatewayProxyResponse {
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return events.APIGatewayProxyResponse{
			StatusCode: 500,
			Headers: map[string]string{
				"Content-Type":                 "application/json",
				"Access-Control-Allow-Origin":  "*",
				"Access-Control-Allow-Headers": "Content-Type,Authorization",
			},
			Body: `{"error": "Internal server error"}`,
		}
	}

	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Content-Type":                 "application/json",
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Headers": "Content-Type,Authorization",
		},
		Body: string(jsonBody),
	}
}

// ErrorResponse represents an error response body
type ErrorResponse struct {
	Error string `json:"error"`
}

// BuildErrorResponse creates an error response
func BuildErrorResponse(statusCode int, message string) events.APIGatewayProxyResponse {
	return BuildResponse(statusCode, ErrorResponse{Error: message})
}
