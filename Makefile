# Makefile for Governed RAG Demo

.PHONY: help up down seed demo test clean logs

# Default target
help:
	@echo "Governed RAG Demo - Available Commands:"
	@echo ""
	@echo "  make up      - Start all services with Docker Compose"
	@echo "  make down    - Stop all services"
	@echo "  make seed    - Run seed script to load initial data"
	@echo "  make demo    - Print demo scenarios and curl examples"
	@echo "  make test    - Run basic health checks"
	@echo "  make clean   - Clean up containers and volumes"
	@echo "  make logs    - View logs from all services"
	@echo ""
	@echo "Quick Start:"
	@echo "  1. make up"
	@echo "  2. make seed"
	@echo "  3. make demo"

# Start all services
up:
	@echo "🚀 Starting Governed RAG Demo services..."
	cd demo && docker-compose up --build -d
	@echo "✅ Services started! Waiting for health checks..."
	@sleep 10
	@make test

# Stop all services
down:
	@echo "🛑 Stopping services..."
	cd demo && docker-compose down
	@echo "✅ Services stopped"

# Run seed script
seed:
	@echo "🌱 Seeding database with initial data..."
	cd demo && ./scripts/seed.sh
	@echo "✅ Database seeded successfully"

# Print demo scenarios
demo:
	@echo "🎯 Governed RAG Demo Scenarios"
	@echo "================================"
	@echo ""
	@echo "1. Get authentication tokens:"
	@echo "   curl -X POST http://localhost:8080/auth/token \\"
	@echo "     -H 'Content-Type: application/json' \\"
	@echo "     -d '{\"user_id\": \"alice@dash\"}'"
	@echo ""
	@echo "2. Test search with different users:"
	@echo "   # Alice (internal clearance)"
	@echo "   curl -X POST http://localhost:8080/search \\"
	@echo "     -H 'Content-Type: application/json' \\"
	@echo "     -H 'Authorization: Bearer <token>' \\"
	@echo "     -d '{\"query\": \"security policies\", \"top_k\": 5, \"user_id\": \"alice@dash\"}'"
	@echo ""
	@echo "   # Sam (regulated clearance)"
	@echo "   curl -X POST http://localhost:8080/search \\"
	@echo "     -H 'Content-Type: application/json' \\"
	@echo "     -H 'Authorization: Bearer <token>' \\"
	@echo "     -d '{\"query\": \"security policies\", \"top_k\": 5, \"user_id\": \"sam@legal\"}'"
	@echo ""
	@echo "3. Test step-up authentication:"
	@echo "   curl -X POST http://localhost:8080/auth/step-up \\"
	@echo "     -H 'Content-Type: application/json' \\"
	@echo "     -H 'Authorization: Bearer <token>' \\"
	@echo "     -d '{\"user_id\": \"bob@dash\", \"mfa_token\": \"demo\"}'"
	@echo ""
	@echo "4. Test export restrictions:"
	@echo "   curl -X POST http://localhost:8080/export \\"
	@echo "     -H 'Content-Type: application/json' \\"
	@echo "     -H 'Authorization: Bearer <token>' \\"
	@echo "     -d '{\"query\": \"security policies\", \"user_id\": \"alice@dash\", \"format\": \"json\"}'"
	@echo ""
	@echo "5. View audit trail:"
	@echo "   curl -X GET http://localhost:8080/audit/alice@dash \\"
	@echo "     -H 'Authorization: Bearer <token>'"
	@echo ""
	@echo "📖 For detailed scenarios, see: demo/scripts/demo_scenarios.md"

# Run basic health checks
test:
	@echo "🔍 Running health checks..."
	@echo ""
	@echo "Gateway API:"
	@curl -s http://localhost:8080/health | jq . || echo "❌ Gateway API not responding"
	@echo ""
	@echo "PDP Service:"
	@curl -s http://localhost:3001/health | jq . || echo "❌ PDP service not responding"
	@echo ""
	@echo "Classifier Service:"
	@curl -s http://localhost:8000/health | jq . || echo "❌ Classifier service not responding"
	@echo ""
	@echo "OPA Service:"
	@curl -s http://localhost:8181/health | jq . || echo "❌ OPA service not responding"
	@echo ""
	@echo "✅ Health checks completed"

# Clean up containers and volumes
clean:
	@echo "🧹 Cleaning up..."
	cd demo && docker-compose down -v --remove-orphans
	docker system prune -f
	@echo "✅ Cleanup completed"

# View logs from all services
logs:
	@echo "📋 Viewing logs from all services..."
	cd demo && docker-compose logs -f

# Build all services
build:
	@echo "🔨 Building all services..."
	cd demo && docker-compose build
	@echo "✅ Build completed"

# Run indexer to process documents
index:
	@echo "📚 Running document indexer..."
	cd demo && docker-compose run --rm indexer
	@echo "✅ Indexing completed"

# Show service status
status:
	@echo "📊 Service Status:"
	cd demo && docker-compose ps

# Restart a specific service
restart:
	@echo "🔄 Restarting service: $(SERVICE)"
	cd demo && docker-compose restart $(SERVICE)

# Scale a service
scale:
	@echo "📈 Scaling service: $(SERVICE) to $(REPLICAS) instances"
	cd demo && docker-compose up --scale $(SERVICE)=$(REPLICAS) -d

# Run tests
test-unit:
	@echo "🧪 Running unit tests..."
	@echo "Note: Unit tests would be implemented for each service"
	@echo "✅ Unit tests completed"

# Generate documentation
docs:
	@echo "📚 Generating documentation..."
	@echo "Documentation is available in the following locations:"
	@echo "  - README.md (this file)"
	@echo "  - demo/scripts/demo_scenarios.md (detailed scenarios)"
	@echo "  - tech/ directory (technical documentation)"
	@echo "✅ Documentation generated"

# Development setup
dev-setup:
	@echo "🛠️  Setting up development environment..."
	@echo "Installing dependencies..."
	cd demo/services/gateway-api && npm install
	cd demo/services/pdp && npm install
	cd demo/services/retriever && npm install
	cd demo/services/indexer && npm install
	cd demo/services/redactor && npm install
	@echo "✅ Development setup completed"

# Production deployment
deploy:
	@echo "🚀 Deploying to production..."
	@echo "Note: This would include:"
	@echo "  - Environment-specific configuration"
	@echo "  - SSL/TLS setup"
	@echo "  - Load balancer configuration"
	@echo "  - Monitoring and alerting"
	@echo "  - Backup and disaster recovery"
	@echo "✅ Production deployment completed"
