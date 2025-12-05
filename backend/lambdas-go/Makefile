.PHONY: all build clean tidy

# Build all Lambda functions
all: tidy build

# Download dependencies
tidy:
	go mod tidy

# Build all Lambda functions for AWS Lambda (Linux ARM64)
build: build-health build-get-files build-upload-file build-download-file build-delete-file build-audit-file

build-health:
	GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o bin/health/bootstrap ./health
	cd bin/health && zip ../health.zip bootstrap

build-get-files:
	GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o bin/get_files/bootstrap ./get_files
	cd bin/get_files && zip ../get_files.zip bootstrap

build-upload-file:
	GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o bin/upload_file/bootstrap ./upload_file
	cd bin/upload_file && zip ../upload_file.zip bootstrap

build-download-file:
	GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o bin/download_file/bootstrap ./download_file
	cd bin/download_file && zip ../download_file.zip bootstrap

build-delete-file:
	GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o bin/delete_file/bootstrap ./delete_file
	cd bin/delete_file && zip ../delete_file.zip bootstrap

build-audit-file:
	GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o bin/audit_file/bootstrap ./audit_file
	cd bin/audit_file && zip ../audit_file.zip bootstrap

# Clean build artifacts
clean:
	rm -rf bin/*
